from __future__ import annotations

import argparse
import csv
import io
import json
import queue
import sqlite3
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from flask import Flask, Response, jsonify, request, send_file, send_from_directory, session, stream_with_context
from werkzeug.security import check_password_hash, generate_password_hash


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR.parent
DB_PATH = DATA_DIR / "rpi_monitoreo.sqlite"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

RPI_PROCESS_FAMILIES = [
    "consulta_y_consentimiento",
    "procesos_cpli",
    "documentaciones",
    "servicios_ecosistemicos",
    "seguridad_alimentaria_escolar",
    "autogestion_comunitaria",
    "liderazgo_comunitario",
    "estudios_sociales_indigena",
    "seguimiento_componente_indigena",
    "infraestructura_social_agua",
    "infraestructura_camino",
]

RPI_EVIDENCE_TYPES = [
    "actas",
    "informes",
    "registros",
    "encuesta",
    "relevamiento",
    "mapas",
    "audiovisuales",
    "facturas",
    "solicitud",
    "materiales",
    "notas",
    "analisis",
]

RPI_ACTORS = ["INDI", "LA", "Líder comunitario", "Técnico", "Comunidad", "Otro"]

DEFAULT_USERS = [
    {"username": "admin", "password": "rpi2026", "display_name": "Administrador RPI", "role": "admin"},
    {"username": "laura", "password": "renta2026", "display_name": "Laura", "role": "tecnico"},
]


app = Flask(__name__, static_folder=".", static_url_path="")
app.config["SECRET_KEY"] = "rpi-local-first-secret-change-me"
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

subscribers: set[queue.Queue[str]] = set()
subscribers_lock = threading.Lock()


def resolve_seed_csv() -> Path:
    exact = APP_DIR.parent / "RPI - PROGRAMA DE VINCULACIÓN CON PUEBLOS INDÍGENAS" / "RPI_BASE_MAESTRA_ACTUAL.csv"
    if exact.exists():
        return exact
    matches = sorted(APP_DIR.parent.glob("RPI - PROGRAMA*/RPI_BASE_MAESTRA_ACTUAL.csv"))
    return matches[0] if matches else exact


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_key(value: Any) -> str:
    return normalize_text(value).lower()


def slugify(value: Any) -> str:
    text = normalize_key(value)
    out = []
    prev_dash = False
    for ch in text:
        if ch.isalnum():
            out.append(ch)
            prev_dash = False
        else:
            if not prev_dash:
                out.append("-")
                prev_dash = True
    return "".join(out).strip("-")


def infer_kind(filename: str, mime_type: str) -> str:
    mime = normalize_key(mime_type)
    name = normalize_key(filename)
    if mime.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return "imagen"
    if mime.startswith("video/") or name.endswith((".mp4", ".mov", ".avi", ".mkv", ".webm")):
        return "video"
    if mime.startswith("audio/") or name.endswith((".mp3", ".wav", ".m4a")):
        return "audio"
    return "documento"


def get_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA temp_store = MEMORY")
    return conn


def create_schema() -> None:
    conn = get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'tecnico',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_meta (
                meta_key TEXT PRIMARY KEY,
                meta_value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_uuid TEXT NOT NULL UNIQUE,
                is_seeded INTEGER NOT NULL DEFAULT 0,
                source_system TEXT NOT NULL,
                source_origin TEXT,
                original_record_id TEXT,
                sync_status TEXT NOT NULL DEFAULT 'synced',
                year_ref TEXT,
                event_date TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                registered_by TEXT,
                module_code TEXT,
                module_label TEXT,
                process_family TEXT,
                evidence_type TEXT,
                community TEXT,
                actor_clave TEXT,
                expediente_code TEXT,
                line_code TEXT,
                line_name TEXT,
                top_block TEXT,
                title TEXT,
                summary TEXT,
                notes TEXT,
                rel_path TEXT,
                abs_path TEXT,
                attachment_count INTEGER NOT NULL DEFAULT 0,
                payload_json TEXT
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                kind TEXT NOT NULL,
                created_at TEXT NOT NULL,
                content BLOB NOT NULL,
                FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_records_event_date ON records(event_date);
            CREATE INDEX IF NOT EXISTS idx_records_process_family ON records(process_family);
            CREATE INDEX IF NOT EXISTS idx_records_community ON records(community);
            CREATE INDEX IF NOT EXISTS idx_records_source ON records(source_system);
            CREATE INDEX IF NOT EXISTS idx_attachments_record_id ON attachments(record_id);
            """
        )
        conn.commit()
    finally:
        conn.close()


def seed_users() -> None:
    conn = get_connection()
    try:
        for user in DEFAULT_USERS:
            exists = conn.execute("SELECT id FROM users WHERE username = ?", [user["username"]]).fetchone()
            if exists:
                continue
            conn.execute(
                """
                INSERT INTO users (username, password_hash, display_name, role, active, created_at)
                VALUES (?, ?, ?, ?, 1, ?)
                """,
                [
                    user["username"],
                    generate_password_hash(user["password"]),
                    user["display_name"],
                    user["role"],
                    utc_now(),
                ],
            )
        conn.commit()
    finally:
        conn.close()


def clear_seeded_records(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM attachments WHERE record_id IN (SELECT id FROM records WHERE is_seeded = 1)")
    conn.execute("DELETE FROM records WHERE is_seeded = 1")


def seed_master_records(force: bool = False) -> int:
    seed_csv = resolve_seed_csv()
    if not seed_csv.exists():
        return 0

    conn = get_connection()
    try:
        current_count = conn.execute("SELECT COUNT(*) AS total FROM records WHERE is_seeded = 1").fetchone()["total"]
        if current_count > 0 and not force:
            return current_count

        if force:
            clear_seeded_records(conn)

        with seed_csv.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            rows = list(reader)

        if not force:
            clear_seeded_records(conn)

        for row in rows:
            event_date = normalize_text(row.get("event_date"))
            year_ref = normalize_text(row.get("year_ref")) or (event_date[:4] if event_date else "")
            process_family = normalize_text(row.get("process_family")) or "general_otro"
            evidence_type = normalize_text(row.get("evidence_type"))
            line_name = normalize_text(row.get("line_name"))
            title = normalize_text(row.get("name")) or line_name or process_family or "Registro histórico RPI"
            summary = normalize_text(row.get("rel_path")) or normalize_text(row.get("relevance_reason"))
            created_at = utc_now()
            conn.execute(
                """
                INSERT INTO records (
                    record_uuid, is_seeded, source_system, source_origin, original_record_id,
                    sync_status, year_ref, event_date, created_at, updated_at, recorded_at,
                    registered_by, module_code, module_label, process_family, evidence_type,
                    community, actor_clave, expediente_code, line_code, line_name, top_block,
                    title, summary, notes, rel_path, abs_path, attachment_count, payload_json
                ) VALUES (?, 1, ?, ?, ?, 'seeded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                [
                    f"SEED-{row.get('registro_id', '')}",
                    normalize_text(row.get("source_system")) or "rpi_seed",
                    normalize_text(row.get("source_origin")),
                    normalize_text(row.get("registro_id")),
                    year_ref,
                    event_date,
                    created_at,
                    created_at,
                    event_date or created_at[:10],
                    "Base maestra RPI",
                    slugify(process_family or line_name or title),
                    line_name or process_family,
                    process_family,
                    evidence_type,
                    normalize_text(row.get("community")),
                    normalize_text(row.get("actor_clave")),
                    normalize_text(row.get("expediente_code")),
                    normalize_text(row.get("line_code")),
                    line_name,
                    normalize_text(row.get("top_block")),
                    title,
                    summary,
                    normalize_text(row.get("relevance_reason")),
                    normalize_text(row.get("rel_path")),
                    normalize_text(row.get("abs_path")),
                    json.dumps(row, ensure_ascii=False),
                ],
            )

        conn.execute(
            """
            INSERT INTO app_meta (meta_key, meta_value)
            VALUES ('last_seed_at', ?)
            ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value
            """,
            [utc_now()],
        )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def current_user() -> sqlite3.Row | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    conn = get_connection()
    try:
        return conn.execute(
            "SELECT id, username, display_name, role, active FROM users WHERE id = ? AND active = 1",
            [user_id],
        ).fetchone()
    finally:
        conn.close()


def require_auth() -> sqlite3.Row | Response:
    user = current_user()
    if user:
        return user
    return jsonify({"success": False, "error": "Sesión no válida"}), 401


def query_scalar(conn: sqlite3.Connection, sql: str, params: list[Any] | tuple[Any, ...] | None = None) -> Any:
    row = conn.execute(sql, params or []).fetchone()
    if row is None:
        return 0
    return row[0]


def build_record_filters(args: dict[str, Any], alias: str = "r") -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    search = normalize_text(args.get("search"))
    if search:
        pattern = f"%{search.lower()}%"
        clauses.append(
            f"""(
                lower(coalesce({alias}.title, '')) LIKE ? OR
                lower(coalesce({alias}.summary, '')) LIKE ? OR
                lower(coalesce({alias}.notes, '')) LIKE ? OR
                lower(coalesce({alias}.community, '')) LIKE ? OR
                lower(coalesce({alias}.process_family, '')) LIKE ? OR
                lower(coalesce({alias}.expediente_code, '')) LIKE ?
            )"""
        )
        params.extend([pattern] * 6)

    for field in ("process_family", "community", "year_ref", "source_system", "evidence_type"):
        value = normalize_text(args.get(field))
        if value:
            clauses.append(f"{alias}.{field} = ?")
            params.append(value)

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_sql, params


def get_catalogs(conn: sqlite3.Connection) -> dict[str, Any]:
    def distinct_values(column: str) -> list[str]:
        rows = conn.execute(
            f"""
            SELECT DISTINCT {column}
            FROM records
            WHERE trim(coalesce({column}, '')) <> ''
            ORDER BY {column}
            """
        ).fetchall()
        return [row[0] for row in rows]

    process_families = distinct_values("process_family")
    evidence_types = distinct_values("evidence_type")
    communities = distinct_values("community")
    years = distinct_values("year_ref")
    top_blocks = distinct_values("top_block")

    catalogs = {
        "processFamilies": sorted(set(process_families + RPI_PROCESS_FAMILIES)),
        "evidenceTypes": sorted(set(evidence_types + RPI_EVIDENCE_TYPES)),
        "communities": communities,
        "actors": sorted(set(distinct_values("actor_clave") + RPI_ACTORS)),
        "years": years,
        "topBlocks": top_blocks,
        "sourceSystems": distinct_values("source_system"),
    }
    return catalogs


def serialize_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "record_uuid": row["record_uuid"],
        "is_seeded": bool(row["is_seeded"]),
        "source_system": row["source_system"],
        "year_ref": row["year_ref"],
        "event_date": row["event_date"],
        "recorded_at": row["recorded_at"],
        "registered_by": row["registered_by"],
        "process_family": row["process_family"],
        "evidence_type": row["evidence_type"],
        "community": row["community"],
        "actor_clave": row["actor_clave"],
        "expediente_code": row["expediente_code"],
        "line_code": row["line_code"],
        "line_name": row["line_name"],
        "top_block": row["top_block"],
        "title": row["title"],
        "summary": row["summary"],
        "notes": row["notes"],
        "attachment_count": row["attachment_count"],
        "rel_path": row["rel_path"],
    }


def broadcast_event(event_type: str, payload: dict[str, Any]) -> None:
    message = json.dumps({"type": event_type, "payload": payload}, ensure_ascii=False)
    dead: list[queue.Queue[str]] = []
    with subscribers_lock:
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(message)
            except queue.Full:
                dead.append(subscriber)
        for subscriber in dead:
            subscribers.discard(subscriber)


@app.get("/")
def serve_index() -> Response:
    return send_from_directory(APP_DIR, "index.html")


@app.get("/api/health")
def api_health() -> Response:
    return jsonify(
        {
            "success": True,
            "app": "RPI local-first monitor",
            "db_path": str(DB_PATH),
            "seed_csv_found": resolve_seed_csv().exists(),
            "server_time": utc_now(),
        }
    )


@app.post("/api/login")
def api_login() -> Response:
    data = request.get_json(silent=True) or {}
    username = normalize_text(data.get("username"))
    password = normalize_text(data.get("password"))
    if not username or not password:
        return jsonify({"success": False, "error": "Usuario y contraseña son obligatorios"}), 400

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, username, password_hash, display_name, role, active FROM users WHERE username = ?",
            [username],
        ).fetchone()
    finally:
        conn.close()

    if not row or not row["active"] or not check_password_hash(row["password_hash"], password):
        return jsonify({"success": False, "error": "Credenciales inválidas"}), 401

    session["user_id"] = row["id"]
    return jsonify(
        {
            "success": True,
            "user": {
                "id": row["id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "role": row["role"],
            },
        }
    )


@app.post("/api/logout")
def api_logout() -> Response:
    session.clear()
    return jsonify({"success": True})


@app.get("/api/bootstrap")
def api_bootstrap() -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    conn = get_connection()
    try:
        catalogs = get_catalogs(conn)
        last_seed_at = conn.execute(
            "SELECT meta_value FROM app_meta WHERE meta_key = 'last_seed_at'"
        ).fetchone()
    finally:
        conn.close()

    return jsonify(
        {
            "success": True,
            "user": {
                "id": auth["id"],
                "username": auth["username"],
                "display_name": auth["display_name"],
                "role": auth["role"],
            },
            "catalogs": catalogs,
            "settings": {
                "maxUploadMb": MAX_UPLOAD_BYTES // (1024 * 1024),
                "lastSeedAt": last_seed_at["meta_value"] if last_seed_at else None,
            },
        }
    )


@app.get("/api/dashboard")
def api_dashboard() -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    filters = {
        "process_family": request.args.get("process_family"),
        "community": request.args.get("community"),
        "year_ref": request.args.get("year_ref"),
        "source_system": request.args.get("source_system"),
        "evidence_type": request.args.get("evidence_type"),
        "search": request.args.get("search"),
    }

    conn = get_connection()
    try:
        where_sql, params = build_record_filters(filters)
        total_records = query_scalar(conn, f"SELECT COUNT(*) FROM records r {where_sql}", params)
        communities_covered = query_scalar(
            conn,
            f"SELECT COUNT(DISTINCT r.community) FROM records r {where_sql} AND trim(coalesce(r.community, '')) <> ''"
            if where_sql
            else "SELECT COUNT(DISTINCT community) FROM records WHERE trim(coalesce(community, '')) <> ''",
            params,
        )
        current_month = date.today().strftime("%Y-%m")
        month_params = list(params) + [f"{current_month}%"]
        new_this_month = query_scalar(
            conn,
            f"SELECT COUNT(*) FROM records r {where_sql + (' AND ' if where_sql else 'WHERE ')} coalesce(r.event_date, substr(r.created_at, 1, 10)) LIKE ?",
            month_params,
        )
        attachments_total = query_scalar(
            conn,
            f"""
            SELECT COUNT(*)
            FROM attachments a
            JOIN records r ON r.id = a.record_id
            {where_sql}
            """,
            params,
        )

        by_process = conn.execute(
            f"""
            SELECT r.process_family, COUNT(*) AS total
            FROM records r
            {where_sql}
            GROUP BY r.process_family
            ORDER BY total DESC, r.process_family
            LIMIT 12
            """,
            params,
        ).fetchall()

        by_evidence = conn.execute(
            f"""
            SELECT r.evidence_type, COUNT(*) AS total
            FROM records r
            {where_sql}
            GROUP BY r.evidence_type
            ORDER BY total DESC, r.evidence_type
            LIMIT 12
            """,
            params,
        ).fetchall()

        by_community = conn.execute(
            f"""
            SELECT r.community, COUNT(*) AS total
            FROM records r
            {where_sql}
            GROUP BY r.community
            ORDER BY total DESC, r.community
            LIMIT 12
            """,
            params,
        ).fetchall()

        timeline = conn.execute(
            f"""
            SELECT substr(coalesce(r.event_date, substr(r.created_at, 1, 10)), 1, 7) AS bucket, COUNT(*) AS total
            FROM records r
            {where_sql}
            GROUP BY bucket
            ORDER BY bucket
            """,
            params,
        ).fetchall()

        recent = conn.execute(
            f"""
            SELECT r.*
            FROM records r
            {where_sql}
            ORDER BY coalesce(r.event_date, substr(r.created_at, 1, 10)) DESC, r.id DESC
            LIMIT 8
            """,
            params,
        ).fetchall()
    finally:
        conn.close()

    return jsonify(
        {
            "success": True,
            "kpis": {
                "totalRecords": total_records,
                "newThisMonth": new_this_month,
                "communitiesCovered": communities_covered,
                "attachmentsTotal": attachments_total,
            },
            "byProcess": [{"label": row["process_family"] or "Sin clasificar", "value": row["total"]} for row in by_process],
            "byEvidence": [{"label": row["evidence_type"] or "Sin tipificar", "value": row["total"]} for row in by_evidence],
            "byCommunity": [{"label": row["community"] or "Sin comunidad", "value": row["total"]} for row in by_community],
            "timeline": [{"label": row["bucket"] or "Sin fecha", "value": row["total"]} for row in timeline],
            "recent": [serialize_record(row) for row in recent],
        }
    )


@app.get("/api/records")
def api_records() -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    filters = {
        "process_family": request.args.get("process_family"),
        "community": request.args.get("community"),
        "year_ref": request.args.get("year_ref"),
        "source_system": request.args.get("source_system"),
        "evidence_type": request.args.get("evidence_type"),
        "search": request.args.get("search"),
    }
    limit = min(int(request.args.get("limit", "250")), 500)
    conn = get_connection()
    try:
        where_sql, params = build_record_filters(filters)
        rows = conn.execute(
            f"""
            SELECT r.*
            FROM records r
            {where_sql}
            ORDER BY coalesce(r.event_date, substr(r.created_at, 1, 10)) DESC, r.id DESC
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()
    finally:
        conn.close()

    return jsonify({"success": True, "records": [serialize_record(row) for row in rows]})


@app.get("/api/records/<int:record_id>")
def api_record_detail(record_id: int) -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM records WHERE id = ?", [record_id]).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Registro no encontrado"}), 404

        attachments = conn.execute(
            """
            SELECT id, filename, mime_type, size_bytes, kind, created_at
            FROM attachments
            WHERE record_id = ?
            ORDER BY id
            """,
            [record_id],
        ).fetchall()
    finally:
        conn.close()

    record = serialize_record(row)
    record["payload_json"] = json.loads(row["payload_json"]) if row["payload_json"] else {}
    record["attachments"] = [
        {
            "id": item["id"],
            "filename": item["filename"],
            "mime_type": item["mime_type"],
            "size_bytes": item["size_bytes"],
            "kind": item["kind"],
            "url": f"/api/attachments/{item['id']}/download",
        }
        for item in attachments
    ]
    return jsonify({"success": True, "record": record})


@app.get("/api/attachments/<int:attachment_id>/download")
def api_attachment_download(attachment_id: int) -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    conn = get_connection()
    try:
        row = conn.execute(
            """
            SELECT filename, mime_type, content
            FROM attachments
            WHERE id = ?
            """,
            [attachment_id],
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return jsonify({"success": False, "error": "Adjunto no encontrado"}), 404

    return send_file(
        io.BytesIO(row["content"]),
        mimetype=row["mime_type"],
        as_attachment=False,
        download_name=row["filename"],
    )


@app.post("/api/records")
def api_create_record() -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    payload_text = request.form.get("payload")
    payload = json.loads(payload_text) if payload_text else (request.get_json(silent=True) or {})

    process_family = normalize_text(payload.get("process_family"))
    community = normalize_text(payload.get("community"))
    title = normalize_text(payload.get("title"))
    if not process_family or not community or not title:
        return jsonify({"success": False, "error": "Proceso, comunidad y título son obligatorios"}), 400

    event_date = normalize_text(payload.get("event_date")) or date.today().isoformat()
    created_at = utc_now()
    record_uuid = f"RPI-{uuid4().hex[:10].upper()}"
    line_name = normalize_text(payload.get("line_name"))
    module_code = normalize_text(payload.get("module_key")) or slugify(process_family or line_name or title)
    module_label = normalize_text(payload.get("module_label")) or line_name or process_family

    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO records (
                record_uuid, is_seeded, source_system, source_origin, original_record_id, sync_status,
                year_ref, event_date, created_at, updated_at, recorded_at, registered_by, module_code,
                module_label, process_family, evidence_type, community, actor_clave, expediente_code,
                line_code, line_name, top_block, title, summary, notes, rel_path, abs_path,
                attachment_count, payload_json
            ) VALUES (?, 0, 'captura_web', 'app_rpi_web', '', 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?)
            """,
            [
                record_uuid,
                normalize_text(payload.get("year_ref")) or event_date[:4],
                event_date,
                created_at,
                created_at,
                event_date,
                auth["display_name"],
                module_code,
                module_label,
                process_family,
                normalize_text(payload.get("evidence_type")),
                community,
                normalize_text(payload.get("actor_clave")),
                normalize_text(payload.get("expediente_code")),
                normalize_text(payload.get("line_code")),
                line_name,
                normalize_text(payload.get("top_block")) or module_label or "captura_manual",
                title,
                normalize_text(payload.get("summary")),
                normalize_text(payload.get("notes")),
                json.dumps(payload, ensure_ascii=False),
            ],
        )
        record_id = cursor.lastrowid

        attachment_count = 0
        for file_storage in request.files.getlist("attachments"):
            if not file_storage or not file_storage.filename:
                continue
            content = file_storage.read()
            attachment_count += 1
            conn.execute(
                """
                INSERT INTO attachments (record_id, filename, mime_type, size_bytes, kind, created_at, content)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    record_id,
                    file_storage.filename,
                    normalize_text(file_storage.mimetype) or "application/octet-stream",
                    len(content),
                    infer_kind(file_storage.filename, file_storage.mimetype or ""),
                    created_at,
                    content,
                ],
            )

        conn.execute(
            "UPDATE records SET attachment_count = ?, updated_at = ? WHERE id = ?",
            [attachment_count, created_at, record_id],
        )
        conn.commit()

        row = conn.execute("SELECT * FROM records WHERE id = ?", [record_id]).fetchone()
    finally:
        conn.close()

    payload_out = serialize_record(row)
    broadcast_event("record_created", payload_out)
    return jsonify({"success": True, "record": payload_out})


@app.get("/api/events")
def api_events() -> Response:
    auth = require_auth()
    if not isinstance(auth, sqlite3.Row):
        return auth

    def stream() -> Any:
        q: queue.Queue[str] = queue.Queue(maxsize=20)
        with subscribers_lock:
            subscribers.add(q)

        try:
            yield "retry: 4000\n\n"
            while True:
                try:
                    message = q.get(timeout=15)
                    yield f"data: {message}\n\n"
                except queue.Empty:
                    yield ": ping\n\n"
        finally:
            with subscribers_lock:
                subscribers.discard(q)

    return Response(stream_with_context(stream()), mimetype="text/event-stream")


def run_server(host: str, port: int, reseed: bool) -> None:
    create_schema()
    seed_users()
    seed_master_records(force=reseed)
    app.run(host=host, port=port, debug=False, threaded=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="App web local-first para monitoreo RPI")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--reseed", action="store_true", help="Recarga la base desde RPI_BASE_MAESTRA_ACTUAL.csv")
    args = parser.parse_args()
    run_server(args.host, args.port, args.reseed)


if __name__ == "__main__":
    main()
