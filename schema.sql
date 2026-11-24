-- ============================================================================
-- CineVault Online Movie Ticket Booking System
-- MySQL 8.0+ Normalized Relational Database Schema (BCNF) + Seed Data
-- ============================================================================

CREATE DATABASE IF NOT EXISTS movie_booking
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE movie_booking;

-- Drop tables in reverse dependency order for clean re-initialization
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS show_seats;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS shows;
DROP TABLE IF EXISTS seats;
DROP TABLE IF EXISTS screens;
DROP TABLE IF EXISTS theaters;
DROP TABLE IF EXISTS movies;

-- 1. Movies Catalog
CREATE TABLE movies (
    movie_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    language VARCHAR(60) NOT NULL,
    genre VARCHAR(100) NOT NULL,
    certification VARCHAR(10) NOT NULL DEFAULT 'UA',
    release_date DATE NOT NULL,
    poster_url VARCHAR(500) NOT NULL
) ENGINE=InnoDB;

-- 2. Cinema Theaters / Venues
CREATE TABLE theaters (
    theater_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    city VARCHAR(80) NOT NULL,
    address VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- 3. Auditorium Screens per Theater
CREATE TABLE screens (
    screen_id INT AUTO_INCREMENT PRIMARY KEY,
    theater_id INT NOT NULL,
    screen_name VARCHAR(60) NOT NULL,
    screen_type ENUM('2D', '3D', 'IMAX') NOT NULL,
    total_seats INT NOT NULL DEFAULT 60 CHECK (total_seats > 0),
    CONSTRAINT fk_screens_theater
        FOREIGN KEY (theater_id) REFERENCES theaters(theater_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 4. Physical Seat Layout per Screen (Rows A-F, Columns 1-10)
CREATE TABLE seats (
    seat_id INT AUTO_INCREMENT PRIMARY KEY,
    screen_id INT NOT NULL,
    row_label CHAR(1) NOT NULL CHECK (row_label IN ('A', 'B', 'C', 'D', 'E', 'F')),
    seat_number TINYINT NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
    seat_type ENUM('STANDARD', 'PREMIUM', 'VIP') NOT NULL,
    CONSTRAINT uq_screen_seat UNIQUE (screen_id, row_label, seat_number),
    CONSTRAINT fk_seats_screen
        FOREIGN KEY (screen_id) REFERENCES screens(screen_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 5. Scheduled Showtimes
CREATE TABLE shows (
    show_id INT AUTO_INCREMENT PRIMARY KEY,
    movie_id INT NOT NULL,
    screen_id INT NOT NULL,
    show_date DATE NOT NULL,
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL CHECK (base_price >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    CONSTRAINT fk_shows_movie
        FOREIGN KEY (movie_id) REFERENCES movies(movie_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_shows_screen
        FOREIGN KEY (screen_id) REFERENCES screens(screen_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_shows_movie_date (movie_id, show_date)
) ENGINE=InnoDB;

-- 6. Customer Bookings
CREATE TABLE bookings (
    booking_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_reference VARCHAR(20) NOT NULL UNIQUE,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(160) NOT NULL,
    customer_phone VARCHAR(24) NOT NULL,
    show_id INT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL CHECK (total_amount >= 0),
    booking_status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    created_at VARCHAR(40) NOT NULL,
    CONSTRAINT fk_bookings_show
        FOREIGN KEY (show_id) REFERENCES shows(show_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_bookings_email (customer_email),
    INDEX idx_bookings_show (show_id)
) ENGINE=InnoDB;

-- 7. Per-Show Seat Inventory & Double-Booking Prevention Lock
CREATE TABLE show_seats (
    show_seat_id INT AUTO_INCREMENT PRIMARY KEY,
    show_id INT NOT NULL,
    seat_code VARCHAR(5) NOT NULL,
    booking_id INT NULL,
    seat_price DECIMAL(10, 2) NOT NULL CHECK (seat_price >= 0),
    status ENUM('AVAILABLE', 'BOOKED') NOT NULL DEFAULT 'AVAILABLE',
    CONSTRAINT uq_show_seat UNIQUE (show_id, seat_code),
    CONSTRAINT fk_show_seats_show
        FOREIGN KEY (show_id) REFERENCES shows(show_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_show_seats_booking
        FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_show_seats_status (show_id, status)
) ENGINE=InnoDB;

-- 8. Payments Audit Ledger
CREATE TABLE payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL UNIQUE,
    amount DECIMAL(10, 2) NOT NULL,
    convenience_fee DECIMAL(10, 2) NOT NULL DEFAULT 30.00,
    payment_method VARCHAR(30) NOT NULL DEFAULT 'ONLINE',
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PAID',
    paid_at VARCHAR(40) NOT NULL,
    CONSTRAINT fk_payments_booking
        FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- Seed Data
-- ============================================================================

INSERT INTO movies (title, description, duration_minutes, language, genre, certification, release_date, poster_url) VALUES
('Solar Odyssey: Eclipse', 'When twin suns begin a catastrophic alignment, a deep-desert navigator must cross the crimson wastes to awaken an ancient orbital ark.', 162, 'English', 'Sci-Fi · Epic', 'UA', '2026-11-12', '/src/assets/images/poster_solar_odyssey_1795513475772.jpg'),
('Midnight Protocol', 'An off-the-grid investigator races through rain-drenched city corridors to dismantle a rogue syndicate before dawn.', 148, 'Hindi', 'Action · Neo-Noir', 'UA', '2026-11-18', '/src/assets/images/poster_midnight_protocol_1795513476068.jpg'),
('Monsoon Symphony', 'Along the Malabar coast, a classical violinist rediscovers a forgotten raga that bridges three generations of musicians.', 134, 'Tamil', 'Drama · Musical', 'U', '2026-11-05', '/src/assets/images/poster_monsoon_symphony_1795513477427.jpg'),
('The Glass Observatory', 'Six astronomers trapped inside a mountain conservatory uncover a coded celestial signal hidden within a century-old lens.', 128, 'English', 'Mystery · Thriller', 'A', '2026-11-20', '/src/assets/images/poster_glass_observatory_1795513478761.jpg');

INSERT INTO theaters (name, city, address) VALUES
('Grand Cineplex Downtown', 'Chennai', '42 Anna Salai, Thousand Lights, Chennai 600006'),
('Star IMAX Mall', 'Chennai', '118 Velachery Main Road, Phoenix District, Chennai 600042');

INSERT INTO screens (theater_id, screen_name, screen_type, total_seats) VALUES
(1, 'Audi 1', '2D', 60),
(1, 'Laser Audi 2', '3D', 60),
(2, 'IMAX Dome', 'IMAX', 60),
(2, 'Premiere Audi 3', '2D', 60);

-- Populate 60 seats (Rows A-F, Columns 1-10) for every screen
DELIMITER //
CREATE PROCEDURE seed_screen_seats_and_show_seats()
BEGIN
    DECLARE v_screen_id INT DEFAULT 1;
    DECLARE v_row_idx INT;
    DECLARE v_col_idx INT;
    DECLARE v_row CHAR(1);
    DECLARE v_seat_type VARCHAR(10);

    WHILE v_screen_id <= 4 DO
        SET v_row_idx = 1;
        WHILE v_row_idx <= 6 DO
            SET v_row = ELT(v_row_idx, 'A', 'B', 'C', 'D', 'E', 'F');
            SET v_seat_type = CASE
                WHEN v_row IN ('A', 'B') THEN 'STANDARD'
                WHEN v_row IN ('C', 'D') THEN 'PREMIUM'
                ELSE 'VIP'
            END;
            SET v_col_idx = 1;
            WHILE v_col_idx <= 10 DO
                INSERT INTO seats (screen_id, row_label, seat_number, seat_type)
                VALUES (v_screen_id, v_row, v_col_idx, v_seat_type);
                SET v_col_idx = v_col_idx + 1;
            END WHILE;
            SET v_row_idx = v_row_idx + 1;
        END WHILE;
        SET v_screen_id = v_screen_id + 1;
    END WHILE;
END //
DELIMITER ;

CALL seed_screen_seats_and_show_seats();
DROP PROCEDURE seed_screen_seats_and_show_seats;

INSERT INTO shows (movie_id, screen_id, show_date, start_time, end_time, base_price, status) VALUES
(1, 3, CURDATE(), '14:15', '16:57', 420.00, 'SCHEDULED'),
(1, 3, CURDATE(), '19:30', '22:12', 450.00, 'SCHEDULED'),
(1, 1, CURDATE(), '18:30', '21:12', 250.00, 'SCHEDULED'),
(2, 2, CURDATE(), '16:00', '18:28', 310.00, 'SCHEDULED'),
(2, 1, CURDATE(), '21:45', '00:13', 260.00, 'SCHEDULED'),
(2, 3, CURDATE(), '22:30', '00:58', 420.00, 'SCHEDULED'),
(3, 4, CURDATE(), '15:15', '17:29', 220.00, 'SCHEDULED'),
(3, 1, CURDATE(), '13:00', '15:14', 210.00, 'SCHEDULED'),
(4, 2, CURDATE(), '19:00', '21:08', 320.00, 'SCHEDULED'),
(4, 4, CURDATE(), '21:15', '23:23', 280.00, 'SCHEDULED');

-- Generate 60 show_seats per scheduled show based on screen seats and tier surcharges
INSERT INTO show_seats (show_id, seat_code, booking_id, seat_price, status)
SELECT
    sh.show_id,
    CONCAT(se.row_label, se.seat_number) AS seat_code,
    NULL AS booking_id,
    CASE se.seat_type
        WHEN 'STANDARD' THEN sh.base_price
        WHEN 'PREMIUM' THEN sh.base_price + 50.00
        ELSE sh.base_price + 100.00
    END AS seat_price,
    'AVAILABLE' AS status
FROM shows sh
JOIN seats se ON se.screen_id = sh.screen_id;
