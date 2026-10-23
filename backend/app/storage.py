"""Acesso ao DynamoDB (metadados) e ao S3 (textos e arquivos).

Uma tabela, chave composta (pk, sk). Cada tipo de registro mora numa partição própria: listar um tipo é uma Query
(nunca um Scan) e lê só aquele tipo, sempre com leitura consistente.

    pk               sk                     o quê
    PAGE             <page_id>              metadados da página + `text` (o texto atual: chave no S3, versão, autor…)
    SEARCH           <page_id>              texto da página preparado para a busca
    TEXT#<page_id>   <versão, 10 dígitos>   um texto anterior da página (histórico de versões)
    REVIEW           <review_id>            proposta de revisão (uma ou várias páginas)
    REDIRECT         <endereço antigo>      id da página que esteve nesse endereço
    ASSET            <asset_id>             arquivo enviado (o conteúdo fica no S3)
    TEMPLATE         <template_id>          modelo de página
    COUNTER          <nome>                 contador atômico ("reviews": número das propostas; "tree": ver abaixo)

Textos são objetos imutáveis no S3 (pages/<id>/<versão>-<sufixo>.md): uma gravação envia o texto novo e só então
aponta a página para ele, numa transação condicionada à versão esperada. Se a transação falhar, sobra só um objeto
órfão (que é apagado em seguida); a página nunca fica com metadados de uma versão e texto de outra.

Toda gravação que muda páginas soma 1 ao contador "tree". As listas em memória (árvore e busca) guardam o valor com
que foram montadas e só são lidas de novo quando ele muda — conferido no máximo a cada CACHE_TTL_SECONDS, então
mudanças feitas por outras instâncias aparecem nesse intervalo, e as desta instância, na hora.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import Settings
from .lib.markdown import to_search_text

log = logging.getLogger(__name__)

MARKDOWN_TYPE = "text/markdown; charset=utf-8"
PAGE, SEARCH, REVIEW, REDIRECT, ASSET, TEMPLATE, COUNTER = (
    "PAGE",
    "SEARCH",
    "REVIEW",
    "REDIRECT",
    "ASSET",
    "TEMPLATE",
    "COUNTER",
)
# uma transação do DynamoDB aceita até 100 operações; uma fica para o contador da árvore
TRANSACT_LIMIT = 99


class VersionConflict(Exception):
    pass


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _text_pk(page_id: str) -> str:
    return f"TEXT#{page_id}"


def _version_sk(version: int) -> str:
    return f"{version:010d}"


def _clean(value: Any) -> Any:
    """Converte Decimals do DynamoDB em int/float."""
    if isinstance(value, list):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    return value


def _plain(item: dict) -> dict:
    """Item do DynamoDB sem a chave (pk/sk) e sem Decimals."""
    return {k: v for k, v in _clean(item).items() if k not in ("pk", "sk")}


def safe_filename(name: str) -> str:
    name = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name.encode("ascii", "ignore").decode()).strip("-.")
    return name[:120] or "file"


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.bucket = settings.s3_bucket
        self.table_name = settings.dynamodb_table
        session = boto3.session.Session(region_name=settings.aws_region)
        retries = {"max_attempts": 3, "mode": "standard"}
        self.dynamodb = session.resource(
            "dynamodb",
            endpoint_url=settings.dynamodb_endpoint_url,
            config=Config(retries=retries),
        )
        self.table = self.dynamodb.Table(self.table_name)
        # cliente do próprio resource: aceita valores Python comuns (inclusive nas transações)
        self.client = self.dynamodb.meta.client
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
        self._lock = threading.Lock()
        # (momento da conferência, valor do contador "tree")
        self._tree: tuple[float, int] | None = None
        # (valor do contador com que foram montadas, conteúdo)
        self._pages: tuple[int, list[dict]] | None = None
        self._search: tuple[int, list[dict]] | None = None

    # ------------------------------------------------------------------ infra
    def ensure_resources(self, attempts: int = 30) -> None:
        """Cria tabela e bucket se não existirem (uso em dev/local)."""
        for attempt in range(1, attempts + 1):
            try:
                self._ensure_table()
                self._ensure_bucket()
                return
            except RuntimeError:
                raise
            except Exception as exc:
                if attempt == attempts:
                    raise
                log.warning("Aguardando DynamoDB/S3 (%s/%s): %s", attempt, attempts, exc)
                time.sleep(1.5)

    def _ensure_table(self) -> None:
        try:
            table = self.client.describe_table(TableName=self.table_name)["Table"]
        except ClientError as exc:
            if _error_code(exc) != "ResourceNotFoundException":
                raise
        else:
            keys = {k["AttributeName"]: k["KeyType"] for k in table["KeySchema"]}
            if keys != {"pk": "HASH", "sk": "RANGE"}:
                raise RuntimeError(
                    f"A tabela {self.table_name} existe com outra chave ({keys}); este app espera pk (HASH) + sk "
                    "(RANGE). Aponte DYNAMODB_TABLE para uma tabela nova."
                )
            return
        log.info("Criando tabela DynamoDB %s", self.table_name)
        self.client.create_table(
            TableName=self.table_name,
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        self.client.get_waiter("table_exists").wait(TableName=self.table_name)

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
            self.client.describe_table(TableName=self.table_name)
            status["dynamodb"] = "ok"
        except Exception as exc:
            status["dynamodb"] = f"erro: {exc}"
        try:
            self.s3.head_bucket(Bucket=self.bucket)
            status["s3"] = "ok"
        except Exception as exc:
            status["s3"] = f"erro: {exc}"
        return status

    # ------------------------------------------------------------------ DynamoDB: blocos básicos
    def _get(self, pk: str, sk: str) -> dict | None:
        item = self.table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True).get("Item")
        return _plain(item) if item else None

    def _put(self, pk: str, sk: str, data: dict) -> None:
        self.table.put_item(Item={**data, "pk": pk, "sk": sk})

    def _query(self, pk: str, **kwargs: Any) -> list[dict]:
        kwargs = {"KeyConditionExpression": Key("pk").eq(pk), "ConsistentRead": True, **kwargs}
        items: list[dict] = []
        while True:
            resp = self.table.query(**kwargs)
            items.extend(resp.get("Items", []))
            if "LastEvaluatedKey" not in resp:
                return [_plain(i) for i in items]
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def _delete_items(self, keys: list[tuple[str, str]]) -> None:
        with self.table.batch_writer() as batch:
            for pk, sk in keys:
                batch.delete_item(Key={"pk": pk, "sk": sk})

    def _put_op(self, pk: str, sk: str, data: dict) -> dict:
        return {"Put": {"TableName": self.table_name, "Item": {**data, "pk": pk, "sk": sk}}}

    def _page_update_op(self, page_id: str, fields: dict, expected_version: int | None = None) -> dict:
        names = {f"#f{i}": key for i, key in enumerate(fields)}
        values = {f":v{i}": value for i, value in enumerate(fields.values())}
        condition = "attribute_exists(pk)"
        if expected_version is not None:
            names["#expected"] = "version"
            values[":expected"] = expected_version
            condition += " AND #expected = :expected"
        return {
            "Update": {
                "TableName": self.table_name,
                "Key": {"pk": PAGE, "sk": page_id},
                "UpdateExpression": "SET " + ", ".join(f"#f{i} = :v{i}" for i in range(len(fields))),
                "ConditionExpression": condition,
                "ExpressionAttributeNames": names,
                "ExpressionAttributeValues": values,
            }
        }

    def _tree_op(self) -> dict:
        return {
            "Update": {
                "TableName": self.table_name,
                "Key": {"pk": COUNTER, "sk": "tree"},
                "UpdateExpression": "ADD #value :one",
                "ExpressionAttributeNames": {"#value": "value"},
                "ExpressionAttributeValues": {":one": 1},
            }
        }

    def _write_pages(self, ops: list[dict]) -> None:
        """Grava mudanças de páginas numa transação, junto do contador da árvore.

        VersionConflict se uma condição (a versão esperada) falhar.
        """
        try:
            self.client.transact_write_items(TransactItems=[*ops, self._tree_op()])
        except ClientError as exc:
            reasons = exc.response.get("CancellationReasons", [])
            if _error_code(exc) == "TransactionCanceledException" and any(
                r.get("Code") == "ConditionalCheckFailed" for r in reasons
            ):
                raise VersionConflict() from exc
            raise
        finally:
            self._forget()

    def _forget(self) -> None:
        """Esta instância acabou de gravar: a próxima leitura confere o contador da árvore na hora."""
        with self._lock:
            self._tree = None

    # ------------------------------------------------------------------ versão da árvore
    def tree_version(self) -> int:
        """Valor do contador "tree": muda a cada gravação de página (serve de cache e de ETag)."""
        now = time.monotonic()
        with self._lock:
            if self._tree and now - self._tree[0] < self.settings.cache_ttl_seconds:
                return self._tree[1]
        item = self._get(COUNTER, "tree")
        value = int(item["value"]) if item else 0
        with self._lock:
            self._tree = (now, value)
        return value

    # ------------------------------------------------------------------ páginas
    def list_pages(self) -> list[dict]:
        """Todas as páginas (metadados e o `text` atual), montadas de novo só quando a árvore muda."""
        version = self.tree_version()  # antes da leitura: uma gravação no meio só faz reler na próxima vez
        with self._lock:
            if self._pages and self._pages[0] == version:
                return [dict(p) for p in self._pages[1]]
        pages = self._query(PAGE)
        with self._lock:
            self._pages = (version, pages)
        return [dict(p) for p in pages]

    def search_documents(self, prepare: Callable[[dict], dict]) -> list[dict]:
        """Páginas com o texto de busca, transformadas por `prepare` e reaproveitadas até a árvore mudar."""
        version = self.tree_version()
        with self._lock:
            if self._search and self._search[0] == version:
                return self._search[1]
        texts = {item["id"]: item.get("text", "") for item in self._query(SEARCH)}
        docs = [prepare({**page, "search_text": texts.get(page["id"], "")}) for page in self.list_pages()]
        with self._lock:
            self._search = (version, docs)
        return docs

    def get_page(self, page_id: str) -> dict | None:
        return self._get(PAGE, page_id)

    def create_page(self, page: dict, content: str) -> None:
        text = self._put_text(page["id"], content, page)
        try:
            self._write_pages(
                [
                    self._put_op(PAGE, page["id"], {**page, "text": text}),
                    self._put_op(SEARCH, page["id"], {"id": page["id"], "text": to_search_text(content)}),
                ]
            )
        except Exception:
            self._delete_object(text["key"])
            raise

    def save_page(self, page: dict, fields: dict, *, content: str | None = None, archive: bool = True) -> None:
        """Grava `fields` (e um texto novo) se a página ainda está na versão de `page`; senão, VersionConflict.

        Com `archive`, o texto substituído entra no histórico; sem (rascunhos), ele é descartado.
        `fields` precisa trazer version, semver, note e updated_by: um texto novo guarda os mesmos.
        """
        page_id = page["id"]
        previous = page.get("text")
        text = None
        ops = []
        if content is not None:
            text = self._put_text(page_id, content, fields)
            fields = {**fields, "text": text}
            ops.append(self._put_op(SEARCH, page_id, {"id": page_id, "text": to_search_text(content)}))
            if archive and previous:
                ops.append(
                    self._put_op(
                        _text_pk(page_id),
                        _version_sk(previous["version"]),
                        {**previous, "page_id": page_id, "archived_at": utcnow()},
                    )
                )
        try:
            self._write_pages([self._page_update_op(page_id, fields, page["version"]), *ops])
        except Exception:
            if text:
                self._delete_object(text["key"])
            raise
        if text and previous and not archive:
            self._delete_object(previous["key"])

    def move_pages(self, changes: dict[str, dict]) -> None:
        """Muda pai/ordem de várias páginas de uma vez (numa transação só, até 99 páginas)."""
        ops = [self._page_update_op(page_id, fields) for page_id, fields in changes.items()]
        for start in range(0, len(ops), TRANSACT_LIMIT):
            self._write_pages(ops[start : start + TRANSACT_LIMIT])

    def delete_page(self, page_id: str) -> None:
        history = [(_text_pk(page_id), _version_sk(e["version"])) for e in self._query(_text_pk(page_id))]
        self._delete_items([(PAGE, page_id), (SEARCH, page_id), *history])
        self.table.update_item(
            Key={"pk": COUNTER, "sk": "tree"},
            UpdateExpression="ADD #value :one",
            ExpressionAttributeNames={"#value": "value"},
            ExpressionAttributeValues={":one": 1},
        )
        self._forget()
        self.delete_prefix(f"pages/{page_id}/")

    # ------------------------------------------------------------------ textos e histórico
    def _put_text(self, page_id: str, content: str, meta: dict) -> dict:
        """Envia um texto novo (objeto imutável) e devolve o que a página guarda sobre ele."""
        body = content.encode("utf-8")
        key = f"pages/{page_id}/{meta['version']}-{uuid.uuid4().hex[:8]}.md"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=MARKDOWN_TYPE)
        return {
            "key": key,
            "version": meta["version"],
            "semver": meta["semver"],
            "author": meta.get("updated_by", ""),
            "note": meta.get("note", ""),
            "saved_at": utcnow(),
            "size": len(body),
        }

    def get_content(self, page: dict) -> str:
        text = page.get("text")
        return (self.get_text(text["key"]) or "") if text else ""

    def list_history(self, page_id: str, limit: int = 50) -> list[dict]:
        """Textos anteriores da página, do mais recente ao mais antigo."""
        items = self.table.query(
            KeyConditionExpression=Key("pk").eq(_text_pk(page_id)),
            ScanIndexForward=False,
            Limit=limit,
            ConsistentRead=True,
        )["Items"]
        return [_history_entry(_plain(i)) for i in items]

    def get_history(self, page_id: str, version_id: str) -> dict | None:
        """Uma versão do histórico, com o texto (`content`)."""
        if not version_id.isdigit():
            return None
        item = self._get(_text_pk(page_id), _version_sk(int(version_id)))
        content = self.get_text(item["key"]) if item else None
        return {**_history_entry(item), "content": content} if item and content is not None else None

    def content_at_version(self, page_id: str, version: int, *, page: dict | None = None) -> str | None:
        """Texto da página na versão `version` (ou o mais recente anterior, se a versão só mudou metadados).

        None se nenhum texto dessa época foi guardado (rascunhos não guardam histórico).
        """
        page = page or self.get_page(page_id)
        current = (page or {}).get("text")
        if current and current["version"] <= version:
            return self.get_text(current["key"])
        items = self.table.query(
            KeyConditionExpression=Key("pk").eq(_text_pk(page_id)) & Key("sk").lte(_version_sk(version)),
            ScanIndexForward=False,
            Limit=1,
            ConsistentRead=True,
        )["Items"]
        return self.get_text(items[0]["key"]) if items else None

    # ------------------------------------------------------------------ revisões
    def put_review(self, review: dict) -> None:
        self._put(REVIEW, review["id"], review)

    def get_review(self, review_id: str) -> dict | None:
        return self._get(REVIEW, review_id)

    def list_reviews(self) -> list[dict]:
        return self._query(REVIEW)

    def delete_review(self, review_id: str) -> None:
        self._delete_items([(REVIEW, review_id)])
        self.delete_prefix(f"reviews/{review_id}/")

    def next_number(self, name: str) -> int:
        """Contador atômico (ex.: número sequencial das propostas)."""
        resp = self.table.update_item(
            Key={"pk": COUNTER, "sk": name},
            UpdateExpression="ADD #value :one",
            ExpressionAttributeNames={"#value": "value"},
            ExpressionAttributeValues={":one": 1},
            ReturnValues="UPDATED_NEW",
        )
        return int(resp["Attributes"]["value"])

    # ------------------------------------------------------------------ redirecionamentos
    # endereço antigo -> id da página (não o endereço novo): mudanças seguintes não criam cadeias
    def put_redirect(self, old_path: str, page_id: str) -> None:
        self._put(REDIRECT, old_path, {"page_id": page_id, "created_at": utcnow()})

    def get_redirect(self, old_path: str) -> str | None:
        item = self._get(REDIRECT, old_path)
        return item["page_id"] if item else None

    # ------------------------------------------------------------------ modelos de página
    def put_template(self, template: dict) -> None:
        self._put(TEMPLATE, template["id"], template)

    def get_template(self, template_id: str) -> dict | None:
        return self._get(TEMPLATE, template_id)

    def list_templates(self) -> list[dict]:
        return self._query(TEMPLATE)

    def delete_template(self, template_id: str) -> None:
        self._delete_items([(TEMPLATE, template_id)])

    # ------------------------------------------------------------------ arquivos
    def put_asset(
        self, data: bytes, filename: str, content_type: str, author: str, spec_kind: str | None = None
    ) -> dict:
        asset_id = uuid.uuid4().hex[:12]
        name = safe_filename(filename)
        key = f"assets/{asset_id}/{name}"
        content_type = content_type or "application/octet-stream"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        asset = {
            "id": asset_id,
            "name": name,
            "key": key,
            "url": f"/api/assets/{asset_id}/{name}",
            "size": len(data),
            "content_type": content_type,
            "last_modified": utcnow(),
            # contrato OpenAPI/AsyncAPI reconhecido no envio
            "spec_kind": spec_kind,
            "author": author,
        }
        self._put(ASSET, asset_id, asset)
        return asset

    def list_assets(self) -> list[dict]:
        return sorted(self._query(ASSET), key=lambda a: a["last_modified"], reverse=True)

    def get_asset(self, asset_id: str, filename: str) -> dict | None:
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=f"assets/{asset_id}/{filename}")
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey"):
                return None
            raise

    def delete_asset(self, asset_id: str, filename: str) -> None:
        self._delete_object(f"assets/{asset_id}/{filename}")
        self._delete_items([(ASSET, asset_id)])

    # ------------------------------------------------------------------ S3
    def put_text(self, key: str, text: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=text.encode("utf-8"), ContentType=MARKDOWN_TYPE)

    def get_text(self, key: str) -> str | None:
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if _error_code(exc) in ("404", "NoSuchKey"):
                return None
            raise
        return obj["Body"].read().decode("utf-8")

    def delete_prefix(self, prefix: str) -> None:
        keys = [{"Key": o["Key"]} for o in self._list(prefix)]
        for i in range(0, len(keys), 1000):
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys[i : i + 1000], "Quiet": True})

    def _delete_object(self, key: str) -> None:
        try:
            self.s3.delete_object(Bucket=self.bucket, Key=key)
        except ClientError:
            log.warning("Não foi possível apagar %s do S3", key, exc_info=True)

    def _list(self, prefix: str) -> Iterator[dict]:
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            yield from page.get("Contents", [])


def _history_entry(item: dict) -> dict:
    return {
        "id": str(item["version"]),
        "author": item.get("author", ""),
        "size": item.get("size", 0),
        "version": item["version"],
        "semver": item["semver"],
        "note": item.get("note", ""),
        # quando o texto foi escrito e quando foi substituído pelo seguinte
        "created_at": item["saved_at"],
        "archived_at": item.get("archived_at", item["saved_at"]),
    }
