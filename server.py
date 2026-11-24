"""
CineVault — Online Movie Ticket Booking System
Zero-Dependency Python 3 Micro-Server (Standard Library Only)

Serves:
  1. REST API (/api/*) backed by SQLite 3 (auto-created movie_booking.db)
  2. Static SPA frontend (index.html, style.css, app.js, /src/assets/*)
"""

from __future__ import annotations

import datetime
import http.server
import json
import mimetypes
import os
import random
import re
import socketserver
import sqlite3
import threading
import urllib.parse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "movie_booking.db")
PORT = int(os.environ.get("PORT", "5000"))
CONVENIENCE_FEE = 30.00
MAX_SEATS_PER_BOOKING = 6

DB_WRITE_LOCK = threading.Lock()

EMAIL_REGEX = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
SEAT_CODE_REGEX = re.compile(r"^[A-F](10|[1-9])$")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_database() -> None:
    """Create BCNF relational tables if absent and seed sample cinema data."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS movies (
                movie_id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
                language TEXT NOT NULL,
                genre TEXT NOT NULL,
                certification TEXT NOT NULL DEFAULT 'UA',
                release_date TEXT NOT NULL,
                poster_url TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS theaters (
                theater_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                city TEXT NOT NULL,
                address TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS screens (
                screen_id INTEGER PRIMARY KEY AUTOINCREMENT,
                theater_id INTEGER NOT NULL,
                screen_name TEXT NOT NULL,
                screen_type TEXT NOT NULL CHECK (screen_type IN ('2D', '3D', 'IMAX')),
                total_seats INTEGER NOT NULL DEFAULT 60 CHECK (total_seats > 0),
                FOREIGN KEY (theater_id) REFERENCES theaters(theater_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS seats (
                seat_id INTEGER PRIMARY KEY AUTOINCREMENT,
                screen_id INTEGER NOT NULL,
                row_label TEXT NOT NULL CHECK (row_label IN ('A', 'B', 'C', 'D', 'E', 'F')),
                seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
                seat_type TEXT NOT NULL CHECK (seat_type IN ('STANDARD', 'PREMIUM', 'VIP')),
                UNIQUE (screen_id, row_label, seat_number),
                FOREIGN KEY (screen_id) REFERENCES screens(screen_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS shows (
                show_id INTEGER PRIMARY KEY AUTOINCREMENT,
                movie_id INTEGER NOT NULL,
                screen_id INTEGER NOT NULL,
                show_date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                base_price REAL NOT NULL CHECK (base_price >= 0),
                status TEXT NOT NULL DEFAULT 'SCHEDULED',
                FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
                FOREIGN KEY (screen_id) REFERENCES screens(screen_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS bookings (
                booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_reference TEXT NOT NULL UNIQUE,
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                customer_phone TEXT NOT NULL,
                show_id INTEGER NOT NULL,
                total_amount REAL NOT NULL CHECK (total_amount >= 0),
                booking_status TEXT NOT NULL DEFAULT 'CONFIRMED',
                created_at TEXT NOT NULL,
                FOREIGN KEY (show_id) REFERENCES shows(show_id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS show_seats (
                show_seat_id INTEGER PRIMARY KEY AUTOINCREMENT,
                show_id INTEGER NOT NULL,
                seat_code TEXT NOT NULL,
                booking_id INTEGER NULL,
                seat_price REAL NOT NULL CHECK (seat_price >= 0),
                status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'BOOKED')),
                UNIQUE (show_id, seat_code),
                FOREIGN KEY (show_id) REFERENCES shows(show_id) ON DELETE CASCADE,
                FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS payments (
                payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id INTEGER NOT NULL UNIQUE,
                amount REAL NOT NULL,
                convenience_fee REAL NOT NULL DEFAULT 30.0,
                payment_method TEXT NOT NULL DEFAULT 'ONLINE',
                payment_status TEXT NOT NULL DEFAULT 'PAID',
                paid_at TEXT NOT NULL,
                FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE
            );
            """
        )

        movie_count = cur.execute("SELECT COUNT(*) FROM movies").fetchone()[0]
        if movie_count == 0:
            seed_database(conn)
    finally:
        conn.close()


def seed_database(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute("BEGIN IMMEDIATE;")
    try:
        movies_data = [
            (
                "Solar Odyssey: Eclipse",
                "When twin suns begin a catastrophic alignment, a deep-desert navigator must cross the crimson wastes to awaken an ancient orbital ark.",
                162,
                "English",
                "Sci-Fi · Epic",
                "UA",
                "2026-11-12",
                "/src/assets/images/poster_solar_odyssey_1795513475772.jpg",
            ),
            (
                "Midnight Protocol",
                "An off-the-grid investigator races through rain-drenched city corridors to dismantle a rogue syndicate before dawn.",
                148,
                "Hindi",
                "Action · Neo-Noir",
                "UA",
                "2026-11-18",
                "/src/assets/images/poster_midnight_protocol_1795513476068.jpg",
            ),
            (
                "Monsoon Symphony",
                "Along the Malabar coast, a classical violinist rediscovers a forgotten raga that bridges three generations of musicians.",
                134,
                "Tamil",
                "Drama · Musical",
                "U",
                "2026-11-05",
                "/src/assets/images/poster_monsoon_symphony_1795513477427.jpg",
            ),
            (
                "The Glass Observatory",
                "Six astronomers trapped inside a mountain conservatory uncover a coded celestial signal hidden within a century-old lens.",
                128,
                "English",
                "Mystery · Thriller",
                "A",
                "2026-11-20",
                "/src/assets/images/poster_glass_observatory_1795513478761.jpg",
            ),
        ]
        cur.executemany(
            """
            INSERT INTO movies
            (title, description, duration_minutes, language, genre, certification, release_date, poster_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            movies_data,
        )

        theaters_data = [
            ("Grand Cineplex Downtown", "Chennai", "42 Anna Salai, Thousand Lights, Chennai"),
            ("Star IMAX Mall", "Chennai", "118 Velachery Main Road, Phoenix District, Chennai"),
        ]
        cur.executemany(
            "INSERT INTO theaters (name, city, address) VALUES (?, ?, ?)",
            theaters_data,
        )

        screens_data = [
            (1, "Audi 1", "2D", 60),
            (1, "Laser Audi 2", "3D", 60),
            (2, "IMAX Dome", "IMAX", 60),
            (2, "Premiere Audi 3", "2D", 60),
        ]
        cur.executemany(
            "INSERT INTO screens (theater_id, screen_name, screen_type, total_seats) VALUES (?, ?, ?, ?)",
            screens_data,
        )

        # Create 60 physical seats (A1-F10) per screen
        rows = ["A", "B", "C", "D", "E", "F"]
        seat_records = []
        for screen_id in range(1, 5):
            for r in rows:
                seat_type = "STANDARD" if r in ("A", "B") else ("PREMIUM" if r in ("C", "D") else "VIP")
                for num in range(1, 11):
                    seat_records.append((screen_id, r, num, seat_type))
        cur.executemany(
            "INSERT INTO seats (screen_id, row_label, seat_number, seat_type) VALUES (?, ?, ?, ?)",
            seat_records,
        )

        today = datetime.date.today().isoformat()
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

        shows_data = [
            (1, 1, today, "18:30", "21:12", 250.0, "SCHEDULED"),
            (1, 3, today, "14:15", "16:57", 420.0, "SCHEDULED"),
            (1, 3, today, "20:00", "22:42", 450.0, "SCHEDULED"),
            (1, 2, tomorrow, "17:45", "20:27", 320.0, "SCHEDULED"),
            (2, 2, today, "16:00", "18:28", 310.0, "SCHEDULED"),
            (2, 1, today, "21:45", "00:13", 260.0, "SCHEDULED"),
            (2, 3, tomorrow, "19:15", "21:43", 420.0, "SCHEDULED"),
            (3, 4, today, "15:15", "17:29", 220.0, "SCHEDULED"),
            (3, 1, today, "12:30", "14:44", 210.0, "SCHEDULED"),
            (4, 2, today, "19:00", "21:08", 320.0, "SCHEDULED"),
            (4, 4, today, "21:15", "23:23", 280.0, "SCHEDULED"),
        ]
        cur.executemany(
            """
            INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, base_price, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            shows_data,
        )

        # Populate 60 show_seats for every show
        cur.execute(
            """
            INSERT INTO show_seats (show_id, seat_code, booking_id, seat_price, status)
            SELECT
                sh.show_id,
                se.row_label || CAST(se.seat_number AS TEXT) AS seat_code,
                NULL,
                CASE se.seat_type
                    WHEN 'STANDARD' THEN sh.base_price
                    WHEN 'PREMIUM' THEN sh.base_price + 50.0
                    ELSE sh.base_price + 100.0
                END,
                'AVAILABLE'
            FROM shows sh
            JOIN seats se ON se.screen_id = sh.screen_id
            """
        )

        # Pre-seed 2 realistic sample bookings so users see Booked (DB) seats immediately
        sample_ts = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        cur.execute(
            """
            INSERT INTO bookings
            (booking_reference, customer_name, customer_email, customer_phone, show_id, total_amount, booking_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
            """,
            ("TIX-410829", "Arjun Menon", "arjun.menon@example.com", "9840112233", 1, 630.0, sample_ts),
        )
        b1_id = cur.lastrowid
        cur.execute(
            "UPDATE show_seats SET status = 'BOOKED', booking_id = ? WHERE show_id = 1 AND seat_code IN ('C5', 'C6')",
            (b1_id,),
        )
        cur.execute(
            "INSERT INTO payments (booking_id, amount, convenience_fee, payment_method, payment_status, paid_at) VALUES (?, ?, ?, 'UPI', 'PAID', ?)",
            (b1_id, 630.0, CONVENIENCE_FEE, sample_ts),
        )

        cur.execute(
            """
            INSERT INTO bookings
            (booking_reference, customer_name, customer_email, customer_phone, show_id, total_amount, booking_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
            """,
            ("TIX-739204", "Priya Nair", "priya.nair@example.com", "9840556677", 2, 1070.0, sample_ts),
        )
        b2_id = cur.lastrowid
        cur.execute(
            "UPDATE show_seats SET status = 'BOOKED', booking_id = ? WHERE show_id = 2 AND seat_code IN ('E4', 'E5')",
            (b2_id,),
        )
        cur.execute(
            "INSERT INTO payments (booking_id, amount, convenience_fee, payment_method, payment_status, paid_at) VALUES (?, ?, ?, 'CARD', 'PAID', ?)",
            (b2_id, 1070.0, CONVENIENCE_FEE, sample_ts),
        )

        conn.commit()
    except Exception:
        conn.rollback()
        raise


def generate_booking_reference(cur: sqlite3.Cursor) -> str:
    for _ in range(25):
        code = f"TIX-{random.randint(100000, 999999)}"
        exists = cur.execute(
            "SELECT 1 FROM bookings WHERE booking_reference = ?", (code,)
        ).fetchone()
        if not exists:
            return code
    raise RuntimeError("Failed to generate unique booking reference")


class CinemaRequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:
        # Clean concise request logging
        print(f"[{self.log_date_time_string()}] {format % args}")

    def send_json(self, status_code: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self) -> dict:
        length_header = self.headers.get("Content-Length", "0")
        try:
            length = int(length_header)
        except ValueError:
            raise ValueError("Invalid Content-Length header")
        if length <= 0 or length > 1_048_576:
            raise ValueError("Request body is empty or too large")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON payload: {exc.msg}") from exc
        if not isinstance(data, dict):
            raise ValueError("JSON payload must be an object")
        return data

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            return self.handle_health()
        if path == "/api/movies":
            return self.handle_get_movies()
        if path == "/api/shows":
            return self.handle_get_shows(query)
        if path == "/api/show-seats":
            return self.handle_get_show_seats(query)
        if path == "/api/bookings":
            return self.handle_get_bookings(query)

        return self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/bookings":
            return self.handle_create_booking()
        if path == "/api/bookings/cancel":
            return self.handle_cancel_booking()

        self.send_json(404, {"error": f"Unknown endpoint: {path}"})

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        match = re.match(r"^/api/bookings/([^/]+)$", path)
        if match:
            identifier = urllib.parse.unquote(match.group(1))
            return self.cancel_booking_by_identifier(identifier)

        self.send_json(404, {"error": f"Unknown endpoint: {path}"})

    # ------------------------------------------------------------------
    # API Handlers
    # ------------------------------------------------------------------

    def handle_health(self) -> None:
        conn = get_connection()
        try:
            row = conn.execute("SELECT COUNT(*) AS movies_count FROM movies").fetchone()
            self.send_json(
                200,
                {
                    "status": "ok",
                    "database": "sqlite3",
                    "db_file": os.path.basename(DB_PATH),
                    "movies_count": row["movies_count"],
                },
            )
        except Exception as exc:
            self.send_json(500, {"status": "error", "error": str(exc)})
        finally:
            conn.close()

    def handle_get_movies(self) -> None:
        conn = get_connection()
        try:
            rows = conn.execute(
                """
                SELECT
                    m.movie_id,
                    m.title,
                    m.description,
                    m.duration_minutes,
                    m.language,
                    m.genre,
                    m.certification,
                    m.release_date,
                    m.poster_url,
                    COUNT(sh.show_id) AS show_count
                FROM movies m
                LEFT JOIN shows sh ON sh.movie_id = m.movie_id AND sh.status = 'SCHEDULED'
                GROUP BY m.movie_id
                ORDER BY m.movie_id ASC
                """
            ).fetchall()
            self.send_json(200, {"movies": [dict(r) for r in rows]})
        finally:
            conn.close()

    def handle_get_shows(self, query: dict) -> None:
        movie_id_raw = (query.get("movie_id") or [""])[0]
        if not movie_id_raw.isdigit():
            return self.send_json(400, {"error": "Valid integer query parameter 'movie_id' is required"})
        movie_id = int(movie_id_raw)

        conn = get_connection()
        try:
            movie = conn.execute("SELECT * FROM movies WHERE movie_id = ?", (movie_id,)).fetchone()
            if not movie:
                return self.send_json(404, {"error": "Movie not found"})

            # Required 3-table INNER JOIN across shows, screens, and theaters
            rows = conn.execute(
                """
                SELECT
                    sh.show_id,
                    sh.movie_id,
                    sh.screen_id,
                    sh.show_date,
                    sh.start_time,
                    sh.end_time,
                    sh.base_price,
                    sh.status,
                    sc.screen_name,
                    sc.screen_type,
                    sc.total_seats,
                    th.theater_id,
                    th.name AS theater_name,
                    th.city AS theater_city,
                    th.address AS theater_address,
                    (
                        SELECT COUNT(*)
                        FROM show_seats ss
                        WHERE ss.show_id = sh.show_id AND ss.status = 'AVAILABLE'
                    ) AS available_seats
                FROM shows sh
                INNER JOIN screens sc ON sh.screen_id = sc.screen_id
                INNER JOIN theaters th ON sc.theater_id = th.theater_id
                WHERE sh.movie_id = ? AND sh.status = 'SCHEDULED'
                ORDER BY th.name ASC, sh.show_date ASC, sh.start_time ASC
                """,
                (movie_id,),
            ).fetchall()

            self.send_json(
                200,
                {
                    "movie": dict(movie),
                    "shows": [dict(r) for r in rows],
                },
            )
        finally:
            conn.close()

    def handle_get_show_seats(self, query: dict) -> None:
        show_id_raw = (query.get("show_id") or [""])[0]
        if not show_id_raw.isdigit():
            return self.send_json(400, {"error": "Valid integer query parameter 'show_id' is required"})
        show_id = int(show_id_raw)

        conn = get_connection()
        try:
            show_row = conn.execute(
                """
                SELECT
                    sh.show_id,
                    sh.show_date,
                    sh.start_time,
                    sh.end_time,
                    sh.base_price,
                    sh.status,
                    m.movie_id,
                    m.title AS movie_title,
                    m.certification,
                    m.duration_minutes,
                    m.language,
                    sc.screen_id,
                    sc.screen_name,
                    sc.screen_type,
                    th.theater_id,
                    th.name AS theater_name,
                    th.city AS theater_city,
                    th.address AS theater_address
                FROM shows sh
                INNER JOIN movies m ON sh.movie_id = m.movie_id
                INNER JOIN screens sc ON sh.screen_id = sc.screen_id
                INNER JOIN theaters th ON sc.theater_id = th.theater_id
                WHERE sh.show_id = ?
                """,
                (show_id,),
            ).fetchone()

            if not show_row:
                return self.send_json(404, {"error": "Showtime not found"})

            seats = conn.execute(
                """
                SELECT
                    ss.show_seat_id,
                    ss.show_id,
                    ss.seat_code,
                    ss.booking_id,
                    ss.seat_price,
                    ss.status,
                    se.row_label,
                    se.seat_number,
                    se.seat_type
                FROM show_seats ss
                INNER JOIN seats se
                    ON se.screen_id = ?
                    AND (se.row_label || CAST(se.seat_number AS TEXT)) = ss.seat_code
                WHERE ss.show_id = ?
                ORDER BY se.row_label ASC, se.seat_number ASC
                """,
                (show_row["screen_id"], show_id),
            ).fetchall()

            self.send_json(
                200,
                {
                    "show": dict(show_row),
                    "seats": [dict(s) for s in seats],
                    "convenience_fee": CONVENIENCE_FEE,
                    "max_seats": MAX_SEATS_PER_BOOKING,
                },
            )
        finally:
            conn.close()

    def handle_get_bookings(self, query: dict) -> None:
        reference = (query.get("reference") or [""])[0].strip().upper()
        email = (query.get("email") or [""])[0].strip().lower()

        conn = get_connection()
        try:
            sql = """
                SELECT
                    b.booking_id,
                    b.booking_reference,
                    b.customer_name,
                    b.customer_email,
                    b.customer_phone,
                    b.show_id,
                    b.total_amount,
                    b.booking_status,
                    b.created_at,
                    m.title AS movie_title,
                    m.certification,
                    m.language,
                    sh.show_date,
                    sh.start_time,
                    sc.screen_name,
                    sc.screen_type,
                    th.name AS theater_name,
                    GROUP_CONCAT(ss.seat_code, ', ') AS seat_codes
                FROM bookings b
                INNER JOIN shows sh ON b.show_id = sh.show_id
                INNER JOIN movies m ON sh.movie_id = m.movie_id
                INNER JOIN screens sc ON sh.screen_id = sc.screen_id
                INNER JOIN theaters th ON sc.theater_id = th.theater_id
                LEFT JOIN show_seats ss ON ss.booking_id = b.booking_id
            """
            params: list = []
            clauses: list[str] = []
            if reference:
                clauses.append("UPPER(b.booking_reference) = ?")
                params.append(reference)
            if email:
                clauses.append("LOWER(b.customer_email) = ?")
                params.append(email)
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " GROUP BY b.booking_id ORDER BY b.booking_id DESC LIMIT 20"

            rows = conn.execute(sql, params).fetchall()
            self.send_json(200, {"bookings": [dict(r) for r in rows]})
        finally:
            conn.close()

    def handle_create_booking(self) -> None:
        try:
            data = self.read_json_body()
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})

        show_id = data.get("show_id")
        seat_codes_raw = data.get("seat_codes")
        customer_name = str(data.get("customer_name", "")).strip()
        customer_email = str(data.get("customer_email", "")).strip()
        customer_phone = re.sub(r"[\s\-\(\)]", "", str(data.get("customer_phone", "")).strip())

        if not isinstance(show_id, int) or show_id <= 0:
            return self.send_json(400, {"error": "Valid integer 'show_id' is required"})

        if not isinstance(seat_codes_raw, list) or len(seat_codes_raw) == 0:
            return self.send_json(400, {"error": "Please select at least 1 seat"})

        seat_codes = sorted({str(code).strip().upper() for code in seat_codes_raw})
        if len(seat_codes) > MAX_SEATS_PER_BOOKING:
            return self.send_json(
                400, {"error": f"Maximum {MAX_SEATS_PER_BOOKING} seats allowed per booking"}
            )
        for code in seat_codes:
            if not SEAT_CODE_REGEX.match(code):
                return self.send_json(400, {"error": f"Invalid seat code: {code}"})

        if len(customer_name) < 2:
            return self.send_json(400, {"error": "Please enter a valid full name (at least 2 characters)"})
        if not EMAIL_REGEX.match(customer_email):
            return self.send_json(400, {"error": "Please enter a valid email address"})
        if not re.match(r"^(\+?\d{10,14})$", customer_phone):
            return self.send_json(400, {"error": "Please enter a valid 10-digit phone number"})

        with DB_WRITE_LOCK:
            conn = get_connection()
            try:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE;")

                show_info = cur.execute(
                    """
                    SELECT
                        sh.show_id,
                        sh.show_date,
                        sh.start_time,
                        sh.end_time,
                        sh.status,
                        m.title AS movie_title,
                        m.certification,
                        m.language,
                        sc.screen_name,
                        sc.screen_type,
                        th.name AS theater_name,
                        th.address AS theater_address
                    FROM shows sh
                    INNER JOIN movies m ON sh.movie_id = m.movie_id
                    INNER JOIN screens sc ON sh.screen_id = sc.screen_id
                    INNER JOIN theaters th ON sc.theater_id = th.theater_id
                    WHERE sh.show_id = ?
                    """,
                    (show_id,),
                ).fetchone()

                if not show_info or show_info["status"] != "SCHEDULED":
                    conn.rollback()
                    return self.send_json(404, {"error": "Showtime is unavailable or not found"})

                placeholders = ",".join("?" for _ in seat_codes)
                seat_rows = cur.execute(
                    f"""
                    SELECT show_seat_id, seat_code, seat_price, status
                    FROM show_seats
                    WHERE show_id = ? AND seat_code IN ({placeholders})
                    """,
                    [show_id, *seat_codes],
                ).fetchall()

                if len(seat_rows) != len(seat_codes):
                    found = {r["seat_code"] for r in seat_rows}
                    missing = [c for c in seat_codes if c not in found]
                    conn.rollback()
                    return self.send_json(400, {"error": f"Invalid seats for this show: {', '.join(missing)}"})

                already_booked = [r["seat_code"] for r in seat_rows if r["status"] == "BOOKED"]
                if already_booked:
                    conn.rollback()
                    return self.send_json(
                        409,
                        {
                            "error": f"Seats already booked: {', '.join(already_booked)}",
                            "booked_seats": already_booked,
                        },
                    )

                tickets_subtotal = round(sum(float(r["seat_price"]) for r in seat_rows), 2)
                total_amount = round(tickets_subtotal + CONVENIENCE_FEE, 2)
                booking_reference = generate_booking_reference(cur)
                created_at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

                cur.execute(
                    """
                    INSERT INTO bookings
                    (booking_reference, customer_name, customer_email, customer_phone, show_id, total_amount, booking_status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
                    """,
                    (
                        booking_reference,
                        customer_name,
                        customer_email,
                        customer_phone,
                        show_id,
                        total_amount,
                        created_at,
                    ),
                )
                booking_id = cur.lastrowid

                cur.execute(
                    f"""
                    UPDATE show_seats
                    SET status = 'BOOKED', booking_id = ?
                    WHERE show_id = ? AND seat_code IN ({placeholders}) AND status = 'AVAILABLE'
                    """,
                    [booking_id, show_id, *seat_codes],
                )
                if cur.rowcount != len(seat_codes):
                    conn.rollback()
                    return self.send_json(
                        409,
                        {"error": "Seats already booked by another guest. Please reselect."},
                    )

                cur.execute(
                    """
                    INSERT INTO payments (booking_id, amount, convenience_fee, payment_method, payment_status, paid_at)
                    VALUES (?, ?, ?, 'ONLINE', 'PAID', ?)
                    """,
                    (booking_id, total_amount, CONVENIENCE_FEE, created_at),
                )

                conn.commit()

                return self.send_json(
                    201,
                    {
                        "message": "Ticket Confirmed in Database!",
                        "booking": {
                            "booking_id": booking_id,
                            "booking_reference": booking_reference,
                            "customer_name": customer_name,
                            "customer_email": customer_email,
                            "customer_phone": customer_phone,
                            "show_id": show_id,
                            "movie_title": show_info["movie_title"],
                            "certification": show_info["certification"],
                            "language": show_info["language"],
                            "theater_name": show_info["theater_name"],
                            "theater_address": show_info["theater_address"],
                            "screen_name": show_info["screen_name"],
                            "screen_type": show_info["screen_type"],
                            "show_date": show_info["show_date"],
                            "start_time": show_info["start_time"],
                            "seat_codes": seat_codes,
                            "tickets_subtotal": tickets_subtotal,
                            "convenience_fee": CONVENIENCE_FEE,
                            "total_amount": total_amount,
                            "booking_status": "CONFIRMED",
                            "created_at": created_at,
                        },
                    },
                )
            except sqlite3.IntegrityError as exc:
                conn.rollback()
                return self.send_json(409, {"error": f"Booking conflict: {exc}"})
            except Exception as exc:
                conn.rollback()
                return self.send_json(500, {"error": f"Database error: {exc}"})
            finally:
                conn.close()

    def handle_cancel_booking(self) -> None:
        try:
            data = self.read_json_body()
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})

        identifier = data.get("booking_id") or data.get("booking_reference")
        if identifier is None or str(identifier).strip() == "":
            return self.send_json(400, {"error": "Provide 'booking_id' or 'booking_reference' to cancel"})

        return self.cancel_booking_by_identifier(str(identifier).strip())

    def cancel_booking_by_identifier(self, identifier: str) -> None:
        with DB_WRITE_LOCK:
            conn = get_connection()
            try:
                cur = conn.cursor()
                cur.execute("BEGIN IMMEDIATE;")

                if identifier.isdigit():
                    booking = cur.execute(
                        "SELECT * FROM bookings WHERE booking_id = ?", (int(identifier),)
                    ).fetchone()
                else:
                    booking = cur.execute(
                        "SELECT * FROM bookings WHERE UPPER(booking_reference) = ?",
                        (identifier.upper(),),
                    ).fetchone()

                if not booking:
                    conn.rollback()
                    return self.send_json(404, {"error": "Booking not found"})

                if booking["booking_status"] == "CANCELLED":
                    conn.rollback()
                    return self.send_json(400, {"error": "Booking is already cancelled"})

                booking_id = booking["booking_id"]
                released = cur.execute(
                    "SELECT seat_code FROM show_seats WHERE booking_id = ? ORDER BY seat_code ASC",
                    (booking_id,),
                ).fetchall()
                released_codes = [r["seat_code"] for r in released]

                cur.execute(
                    "UPDATE bookings SET booking_status = 'CANCELLED' WHERE booking_id = ?",
                    (booking_id,),
                )
                cur.execute(
                    "UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL WHERE booking_id = ?",
                    (booking_id,),
                )
                cur.execute(
                    "UPDATE payments SET payment_status = 'REFUNDED' WHERE booking_id = ?",
                    (booking_id,),
                )
                conn.commit()

                return self.send_json(
                    200,
                    {
                        "message": "Booking cancelled and seats released back to AVAILABLE.",
                        "booking_id": booking_id,
                        "booking_reference": booking["booking_reference"],
                        "booking_status": "CANCELLED",
                        "released_seats": released_codes,
                    },
                )
            except Exception as exc:
                conn.rollback()
                return self.send_json(500, {"error": f"Failed to cancel booking: {exc}"})
            finally:
                conn.close()

    # ------------------------------------------------------------------
    # Static Frontend File Serving
    # ------------------------------------------------------------------

    def serve_static(self, raw_path: str) -> None:
        clean_path = urllib.parse.unquote(raw_path.split("?", 1)[0])
        if clean_path in ("", "/"):
            clean_path = "/index.html"

        rel_path = clean_path.lstrip("/")
        target_path = os.path.realpath(os.path.join(BASE_DIR, rel_path))

        # Prevent directory traversal outside workspace root
        if not target_path.startswith(os.path.realpath(BASE_DIR)):
            self.send_json(403, {"error": "Forbidden"})
            return

        if not os.path.isfile(target_path):
            # Fallback to SPA index.html for unknown non-asset paths
            if not rel_path.startswith("src/") and "." not in os.path.basename(rel_path):
                target_path = os.path.join(BASE_DIR, "index.html")
            else:
                self.send_json(404, {"error": "File not found"})
                return

        mime_type, _ = mimetypes.guess_type(target_path)
        if target_path.endswith(".js"):
            mime_type = "application/javascript; charset=utf-8"
        elif target_path.endswith(".css"):
            mime_type = "text/css; charset=utf-8"
        elif target_path.endswith(".html"):
            mime_type = "text/html; charset=utf-8"
        elif not mime_type:
            mime_type = "application/octet-stream"

        with open(target_path, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)


class ThreadingCinemaServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    init_database()
    server_address = ("0.0.0.0", PORT)
    httpd = ThreadingCinemaServer(server_address, CinemaRequestHandler)
    print(f"CineVault SQLite DB ready: {DB_PATH}")
    print(f"CineVault micro-server listening on http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down CineVault server...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
