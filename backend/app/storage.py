"""Acesso ao DynamoDB (metadados das páginas) e S3 (conteúdo markdown, histórico e mídia)."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import quote, unquote

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import Settings

log = logging.getLogger(__name__)

MARKDOWN_TYPE = "text/markdown; charset=utf-8"
META_FIELDS = [
    "id",
    "title",
    "slug",
    "parent_id",
    "order",
    "icon",
    "description",
    "published",
    "created_at",
    "updated_at",
    "updated_by",
    "version",
    "note",
    "kind",
]


class VersionConflict(Exception):
    pass


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _clean(value: Any) -> Any:
    """Converte Decimals do DynamoDB em int/float."""
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    return value


def _ascii(value: str) -> str:
    return value.encode("ascii", "ignore").decode() or "-"


def safe_filename(name: str) -> str:
    name = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", _ascii(name)).strip("-.")
    return name[:120] or "file"


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.bucket = settings.s3_bucket
        session = boto3.session.Session(region_name=settings.aws_region)
        retries = {"max_attempts": 3, "mode": "standard"}
        self.dynamodb = session.resource(
            "dynamodb",
            endpoint_url=settings.dynamodb_endpoint_url,
            config=Config(retries=retries),
        )
        self.table = self.dynamodb.Table(settings.dynamodb_table)
        if settings.s3_endpoint_url:
            # Emuladores S3 (SeaweedFS, LocalStack…): path-style e checksums só quando exigidos.
            s3_config = Config(
                retries=retries,
                s3={"addressing_style": "path"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            )
        else:
            s3_config = Config(retries=retries)
        self.s3 = session.client("s3", endpoint_url=settings.s3_endpoint_url, config=s3_config)
        self._cache: tuple[float, list[dict]] | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ infra
    def ensure_resources(self, attempts: int = 30) -> None:
        """Cria tabela e bucket se não existirem (uso em dev/local)."""
        for attempt in range(1, attempts + 1):
            try:
                self._ensure_table()
                self._ensure_bucket()
                return
            except Exception as exc:
                if attempt == attempts:
                    raise
                log.warning("Aguardando DynamoDB/S3 (%s/%s): %s", attempt, attempts, exc)
                time.sleep(1.5)

    def _ensure_table(self) -> None:
        client = self.dynamodb.meta.client
        name = self.settings.dynamodb_table
        try:
            client.describe_table(TableName=name)
            return
        except ClientError as exc:
            if _error_code(exc) != "ResourceNotFoundException":
                raise
        log.info("Criando tabela DynamoDB %s", name)
        client.create_table(
            TableName=name,
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        client.get_waiter("table_exists").wait(TableName=name)

    def _ensure_bucket(self) -> None:
        try:
            self.s3.head_bucket(Bucket=self.bucket)
            return
        except ClientError as exc:
            if _error_code(exc) not in ("404", "NoSuchBucket", "NotFound"):
                raise
        log.info("Criando bucket S3 %s", self.bucket)
        kwargs: dict[str, Any] = {"Bucket": self.bucket}
        if self.settings.aws_region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": self.settings.aws_region}
        self.s3.create_bucket(**kwargs)

    def health(self) -> dict[str, str]:
        status = {}
        try:
            self.dynamodb.meta.client.describe_table(TableName=self.settings.dynamodb_table)
            status["dynamodb"] = "ok"
        except Exception as exc:
            status["dynamodb"] = f"erro: {exc}"
        try:
            self.s3.head_bucket(Bucket=self.bucket)
            status["s3"] = "ok"
        except Exception as exc:
            status["s3"] = f"erro: {exc}"
        return status

    # ------------------------------------------------------------------ páginas
    def invalidate(self) -> None:
        with self._lock:
            self._cache = None

    def list_pages(self, *, full: bool = False) -> list[dict]:
        """Lista todas as páginas. Sem `full`, retorna só metadados (com cache curto)."""
        if not full:
            with self._lock:
                if self._cache and time.monotonic() - self._cache[0] < self.settings.cache_ttl_seconds:
                    return [dict(p) for p in self._cache[1]]
        # a tabela também guarda revisões e contadores (atributo "record"): só páginas aqui
        names: dict[str, str] = {"#rec": "record"}
        kwargs: dict[str, Any] = {"FilterExpression": "attribute_not_exists(#rec)"}
        if not full:
            names.update({f"#f{i}": field for i, field in enumerate(META_FIELDS)})
            kwargs["ProjectionExpression"] = ", ".join(n for n in names if n != "#rec")
        kwargs["ExpressionAttributeNames"] = names
        items: list[dict] = []
        while True:
            resp = self.table.scan(**kwargs)
            items.extend(resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                break
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        pages = [_clean(item) for item in items]
        if not full:
            with self._lock:
                self._cache = (time.monotonic(), pages)
            return [dict(p) for p in pages]
        return pages

    def get_page(self, page_id: str) -> dict | None:
        item = self.table.get_item(Key={"id": page_id}).get("Item")
        return _clean(item) if item and "record" not in item else None

    def put_page(self, item: dict) -> None:
        self.table.put_item(Item=item)
        self.invalidate()

    def update_page(self, page_id: str, fields: dict[str, Any], expected_version: int | None = None) -> dict:
        # Prefixos próprios: o boto3 usa "#n"/":v" para a ConditionExpression e colidiria.
        names = {f"#fld{i}": key for i, key in enumerate(fields)}
        values = {f":val{i}": value for i, value in enumerate(fields.values())}
        sets = [f"#fld{i} = :val{i}" for i in range(len(fields))]
        kwargs: dict[str, Any] = {
            "Key": {"id": page_id},
            "UpdateExpression": "SET " + ", ".join(sets),
            "ExpressionAttributeNames": names,
            "ExpressionAttributeValues": values,
            "ReturnValues": "ALL_NEW",
        }
        condition = Attr("id").exists()
        if expected_version is not None:
            condition = condition & Attr("version").eq(expected_version)
        kwargs["ConditionExpression"] = condition
        try:
            resp = self.table.update_item(**kwargs)
        except ClientError as exc:
            if _error_code(exc) == "ConditionalCheckFailedException":
                raise VersionConflict(page_id) from exc
            raise
        finally:
            self.invalidate()
        return _clean(resp["Attributes"])

    def delete_page(self, page_id: str) -> None:
        self.table.delete_item(Key={"id": page_id})
        self._delete_prefix(f"pages/{page_id}/")
        self.invalidate()

    # ------------------------------------------------------------------ revisões
    def put_review(self, item: dict) -> None:
        self.table.put_item(Item={**item, "record": "review"})

    def get_review(self, review_id: str) -> dict | None:
        item = self.table.get_item(Key={"id": review_id}).get("Item")
        return _clean(item) if item and item.get("record") == "review" else None

    def list_reviews(self, page_id: str | None = None) -> list[dict]:
        names = {"#rec": "record"}
        values: dict[str, Any] = {":review": "review"}
        expression = "#rec = :review"
        if page_id:
            names["#page"] = "page_id"
            values[":page"] = page_id
            expression += " AND #page = :page"
        kwargs: dict[str, Any] = {
            "FilterExpression": expression,
            "ExpressionAttributeNames": names,
            "ExpressionAttributeValues": values,
        }
        items: list[dict] = []
        while True:
            resp = self.table.scan(**kwargs)
            items.extend(resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                break
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        return [_clean(i) for i in items]

    def delete_reviews_for_page(self, page_id: str) -> None:
        for review in self.list_reviews(page_id):
            self.table.delete_item(Key={"id": review["id"]})

    def next_number(self, name: str) -> int:
        """Contador atômico (ex.: número sequencial das revisões)."""
        resp = self.table.update_item(
            Key={"id": f"counter#{name}"},
            UpdateExpression="SET #rec = :rec ADD #val :one",
            ExpressionAttributeNames={"#rec": "record", "#val": "value"},
            ExpressionAttributeValues={":rec": "counter", ":one": 1},
            ReturnValues="UPDATED_NEW",
        )
        return int(resp["Attributes"]["value"])

    # ------------------------------------------------------------------ objetos genéricos no S3
    def put_text(self, key: str, text: str, content_type: str = MARKDOWN_TYPE) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=text.encode("utf-8"), ContentType=content_type)

    def get_text(self, key: str) -> str | None:
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey"):
                return None
            raise
        return obj["Body"].read().decode("utf-8")

    def put_json(self, key: str, data: Any) -> None:
        self.put_text(key, json.dumps(data, ensure_ascii=False), "application/json")

    def get_json(self, key: str, default: Any = None) -> Any:
        text = self.get_text(key)
        return default if text is None else json.loads(text)

    def list_keys(self, prefix: str) -> list[str]:
        return [o["Key"] for o in self._list(prefix)]

    def delete_key(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> None:
        self._delete_prefix(prefix)

    # ------------------------------------------------------------------ conteúdo
    @staticmethod
    def content_key(page_id: str) -> str:
        return f"pages/{page_id}/content.md"

    def get_content(self, page_id: str) -> str:
        return self._get_text(self.content_key(page_id))

    def put_content(
        self,
        page_id: str,
        content: str,
        author: str,
        *,
        version: int | None = None,
        note: str = "",
        archive: bool = True,
    ) -> None:
        """Grava o markdown atual; a versão anterior é arquivada com seus metadados (autor, versão, nota)."""
        key = self.content_key(page_id)
        if archive:
            self._archive(page_id, key)
        metadata = {"author": _ascii(author), "saved-at": utcnow()}
        if version is not None:
            metadata["version"] = str(version)
        if note:
            # metadados do S3 só aceitam ASCII: a nota vai codificada como URL
            metadata["note"] = quote(note[:200], safe="")
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content.encode("utf-8"),
            ContentType=MARKDOWN_TYPE,
            Metadata=metadata,
        )

    def _archive(self, page_id: str, key: str) -> None:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey", "NotFound"):
                return
            raise
        # Momento do arquivamento com microssegundos (LastModified do S3 só tem precisão de segundos).
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        self.s3.copy_object(
            Bucket=self.bucket,
            Key=f"pages/{page_id}/history/{stamp}.md",
            CopySource={"Bucket": self.bucket, "Key": key},
            MetadataDirective="COPY",
        )

    def list_history(self, page_id: str, limit: int = 50) -> list[dict]:
        prefix = f"pages/{page_id}/history/"
        objects = sorted(self._list(prefix), key=lambda o: o["Key"], reverse=True)[:limit]
        entries = []
        for obj in objects:
            version_id = obj["Key"].removeprefix(prefix).removesuffix(".md")
            try:
                meta = self.s3.head_object(Bucket=self.bucket, Key=obj["Key"])["Metadata"]
            except ClientError:
                meta = {}
            version = meta.get("version", "")
            entries.append(
                {
                    "id": version_id,
                    "author": meta.get("author", ""),
                    "size": obj["Size"],
                    "version": int(version) if version.isdigit() else None,
                    "note": unquote(meta.get("note", "")),
                    # quando a versão foi escrita (fallback: quando foi arquivada)
                    "created_at": meta.get("saved-at") or _parse_stamp(version_id) or obj["LastModified"].isoformat(),
                    "archived_at": _parse_stamp(version_id) or obj["LastModified"].isoformat(),
                }
            )
        return entries

    def get_history(self, page_id: str, version_id: str) -> str | None:
        if not re.fullmatch(r"[0-9TZ]+", version_id):
            return None
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=f"pages/{page_id}/history/{version_id}.md")
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey"):
                return None
            raise
        return obj["Body"].read().decode("utf-8")

    # ------------------------------------------------------------------ mídia
    def put_asset(self, data: bytes, filename: str, content_type: str, author: str) -> dict:
        asset_id = uuid.uuid4().hex[:12]
        name = safe_filename(filename)
        key = f"assets/{asset_id}/{name}"
        self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type or "application/octet-stream",
            Metadata={"author": _ascii(author)},
        )
        return self._asset_dict(key, len(data), datetime.now(UTC), content_type)

    def list_assets(self) -> list[dict]:
        objects = sorted(self._list("assets/"), key=lambda o: o["LastModified"], reverse=True)
        return [self._asset_dict(o["Key"], o["Size"], o["LastModified"]) for o in objects]

    def get_asset(self, asset_id: str, filename: str) -> dict | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=f"assets/{asset_id}/{filename}")
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey"):
                return None
            raise

    def delete_asset(self, asset_id: str, filename: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=f"assets/{asset_id}/{filename}")

    @staticmethod
    def _asset_dict(key: str, size: int, modified: datetime, content_type: str | None = None) -> dict:
        _, asset_id, name = key.split("/", 2)
        return {
            "id": asset_id,
            "name": name,
            "key": key,
            "url": f"/api/assets/{asset_id}/{name}",
            "size": size,
            "content_type": content_type,
            "last_modified": modified.isoformat(),
        }

    # ------------------------------------------------------------------ helpers
    def _get_text(self, key: str) -> str:
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey"):
                return ""
            raise
        return obj["Body"].read().decode("utf-8")

    def _list(self, prefix: str) -> Iterator[dict]:
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            yield from page.get("Contents", [])

    def _delete_prefix(self, prefix: str) -> None:
        keys = [{"Key": o["Key"]} for o in self._list(prefix)]
        for i in range(0, len(keys), 1000):
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys[i : i + 1000], "Quiet": True})


def _parse_stamp(stamp: str) -> str | None:
    try:
        return datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").replace(tzinfo=UTC).isoformat(timespec="seconds")
    except ValueError:
        return None
