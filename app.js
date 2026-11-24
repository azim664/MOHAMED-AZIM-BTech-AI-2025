/**
 * CineVault — Online Movie Ticket Booking System (ES6+ Vanilla JS SPA)
 * Connected to Supabase via VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
 * Loads movies from `movies`, showtimes from `showtimes`, and saves seat bookings into `bookings`.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

const hasValidConfig =
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_PUBLISHABLE_KEY) &&
  !SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
  !SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE');

const supabase = hasValidConfig ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

const ROW_ORDER = ['A', 'B', 'C', 'D', 'E', 'F'];
const COLS_PER_ROW = 10;
const TOTAL_SEATS_PER_SHOW = ROW_ORDER.length * COLS_PER_ROW;

const state = {
  stage: 1, // 1: Movies, 2: Showtimes, 3: Seats, 4: Ticket
  movies: [],
  languageFilter: 'ALL',
  selectedMovie: null,
  shows: [],
  selectedShow: null,
  seats: [],
  selectedSeatCodes: new Set(),
  convenienceFee: 30.0,
  maxSeats: 6,
  latestBooking: null,
};

// DOM Elements
const els = {
  dbPill: document.getElementById('db-status-pill'),
  dbStatusText: document.getElementById('db-status-text'),
  progressShell: document.getElementById('progress-shell'),
  progressSteps: document.querySelectorAll('.progress-step'),
  stepTriggers: document.querySelectorAll('.step-trigger'),
  toastContainer: document.getElementById('toast-container'),

  stageMovies: document.getElementById('stage-movies'),
  stageShows: document.getElementById('stage-shows'),
  stageSeats: document.getElementById('stage-seats'),
  stageTicket: document.getElementById('stage-ticket'),

  moviesGrid: document.getElementById('movies-grid'),
  filterBar: document.getElementById('genre-filter-bar'),

  selectedMovieBanner: document.getElementById('selected-movie-banner'),
  theatersList: document.getElementById('theaters-list'),

  showContextBar: document.getElementById('show-context-bar'),
  seatMatrix: document.getElementById('seat-matrix'),
  stickySeatsText: document.getElementById('sticky-seats-text'),
  stickyTotalText: document.getElementById('sticky-total-text'),
  proceedCheckoutBtn: document.getElementById('proceed-checkout-btn'),

  checkoutModal: document.getElementById('checkout-modal'),
  checkoutSummary: document.getElementById('checkout-summary'),
  checkoutForm: document.getElementById('checkout-form'),
  checkoutErrorMsg: document.getElementById('checkout-error-msg'),
  confirmBookingBtn: document.getElementById('confirm-booking-btn'),

  boardingPassCard: document.getElementById('boarding-pass-card'),
  cancelCurrentTicketBtn: document.getElementById('cancel-current-ticket-btn'),

  bookingsModal: document.getElementById('bookings-modal'),
  bookingsList: document.getElementById('bookings-list'),
  bookingSearchForm: document.getElementById('booking-search-form'),
  bookingRefInput: document.getElementById('booking-ref-input'),
};

function formatINR(amount) {
  return `₹${Number(amount).toFixed(2)}`;
}

function formatINRCompact(amount) {
  const num = Number(amount);
  return Number.isInteger(num) ? `₹${num}` : `₹${num.toFixed(2)}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function showToast(message, variant = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${variant}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4200);
}

// ---------------------------------------------------------------------------
// Schema Normalization Helpers (Supports flexible column conventions)
// ---------------------------------------------------------------------------

function normalizeMovie(row) {
  return {
    movie_id: row.id ?? row.movie_id,
    title: row.title || 'Untitled Movie',
    description: row.description || '',
    duration_minutes: Number(row.duration_minutes ?? row.duration ?? 120),
    language: row.language || 'English',
    genre: row.genre || 'Cinema',
    certification: row.certification || 'UA',
    release_date: row.release_date || '',
    poster_url: row.poster_url || '',
  };
}

function normalizeShowtime(row, movie) {
  return {
    showtime_id: row.id ?? row.showtime_id ?? row.show_id,
    movie_id: row.movie_id,
    movie_title: movie?.title || row.movie_title || 'Selected Movie',
    theater_name: row.theater_name || row.theater || 'Grand Cineplex',
    theater_city: row.theater_city || row.city || '',
    theater_address: row.theater_address || row.address || row.theater_city || 'Main Multiplex',
    screen_name: row.screen_name || row.screen || 'Audi 1',
    screen_type: row.screen_type || row.format || '2D',
    show_date: row.show_date || '',
    start_time: row.start_time || row.time || '',
    end_time: row.end_time || '',
    base_price: Number(row.base_price ?? row.price ?? 250),
    status: row.status || 'SCHEDULED',
  };
}

function extractSeatCodes(bookingRow) {
  const raw = bookingRow.seat_codes ?? bookingRow.seats ?? bookingRow.seat_code ?? [];
  if (Array.isArray(raw)) {
    return raw.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
        }
      } catch {
        // Fall through to comma split
      }
    }
    return trimmed
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }
  return [];
}

function isActiveBooking(bookingRow) {
  const status = String(bookingRow.booking_status || bookingRow.status || 'CONFIRMED').toUpperCase();
  return status !== 'CANCELLED';
}

function buildSeatMatrixModel(basePrice, bookedSet) {
  const seats = [];
  for (const rowLabel of ROW_ORDER) {
    const seatType =
      rowLabel === 'A' || rowLabel === 'B'
        ? 'STANDARD'
        : rowLabel === 'C' || rowLabel === 'D'
          ? 'PREMIUM'
          : 'VIP';
    const surcharge = seatType === 'STANDARD' ? 0 : seatType === 'PREMIUM' ? 50 : 100;
    const seatPrice = Number(basePrice) + surcharge;

    for (let seatNumber = 1; seatNumber <= COLS_PER_ROW; seatNumber += 1) {
      const seatCode = `${rowLabel}${seatNumber}`;
      seats.push({
        seat_code: seatCode,
        row_label: rowLabel,
        seat_number: seatNumber,
        seat_type: seatType,
        seat_price: seatPrice,
        status: bookedSet.has(seatCode) ? 'BOOKED' : 'AVAILABLE',
      });
    }
  }
  return seats;
}

function generateBookingReference() {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `TIX-${num}`;
}

// ---------------------------------------------------------------------------
// Supabase Health & Data Queries
// ---------------------------------------------------------------------------

async function checkSupabaseHealth() {
  if (!supabase) {
    els.dbPill.classList.add('offline');
    els.dbStatusText.textContent = 'Supabase Not Configured';
    return false;
  }

  try {
    const { error } = await supabase.from('movies').select('*', { count: 'exact', head: true });
    if (error) {
      els.dbPill.classList.add('offline');
      els.dbStatusText.textContent = 'Supabase Connection Error';
      return false;
    }
    els.dbPill.classList.remove('offline');
    els.dbStatusText.textContent = 'Connected to Supabase (Live)';
    return true;
  } catch {
    els.dbPill.classList.add('offline');
    els.dbStatusText.textContent = 'Supabase Unreachable';
    return false;
  }
}

async function fetchBookingsForShowtime(showtimeId) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('showtime_id', showtimeId);

  if (!error) return data || [];

  // Fallback if user schema uses `show_id` instead of `showtime_id`
  if (String(error.message || '').includes('showtime_id')) {
    const fallback = await supabase.from('bookings').select('*').eq('show_id', showtimeId);
    if (fallback.error) throw new Error(fallback.error.message);
    return fallback.data || [];
  }

  throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Stage Navigation & Progress Stepper
// ---------------------------------------------------------------------------

function goToStage(stageNum) {
  state.stage = stageNum;

  els.stageMovies.hidden = stageNum !== 1;
  els.stageShows.hidden = stageNum !== 2;
  els.stageSeats.hidden = stageNum !== 3;
  els.stageTicket.hidden = stageNum !== 4;

  els.progressShell.hidden = stageNum === 4;

  els.progressSteps.forEach((stepEl) => {
    const step = Number(stepEl.dataset.step);
    const trigger = stepEl.querySelector('.step-trigger');
    stepEl.classList.remove('active', 'completed');

    if (step === stageNum) {
      stepEl.classList.add('active');
      trigger.disabled = false;
    } else if (step < stageNum) {
      stepEl.classList.add('completed');
      trigger.disabled = false;
    } else {
      trigger.disabled = true;
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Stage 1: Movie Catalog (`movies` table)
// ---------------------------------------------------------------------------

async function loadMovies() {
  if (!supabase) {
    els.moviesGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <strong>Supabase environment variables are not configured.</strong><br /><br />
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your environment secrets, and run <code>schema.sql</code> in the Supabase SQL Editor to initialize the <code>movies</code>, <code>showtimes</code>, and <code>bookings</code> tables.
      </div>
    `;
    return;
  }

  els.moviesGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Loading movies from Supabase…</div>`;

  try {
    const { data, error } = await supabase.from('movies').select('*');
    if (error) throw new Error(error.message);

    state.movies = (data || [])
      .map(normalizeMovie)
      .sort((a, b) => Number(a.movie_id) - Number(b.movie_id));

    renderLanguageFilters();
    renderMovies();
  } catch (err) {
    els.moviesGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        Unable to load movies from Supabase: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function renderLanguageFilters() {
  const languages = Array.from(new Set(state.movies.map((m) => m.language).filter(Boolean)));
  const buttons = [
    `<button type="button" class="filter-tab ${state.languageFilter === 'ALL' ? 'active' : ''}" data-lang="ALL">All Languages</button>`,
    ...languages.map(
      (lang) =>
        `<button type="button" class="filter-tab ${state.languageFilter.toLowerCase() === lang.toLowerCase() ? 'active' : ''}" data-lang="${escapeHtml(lang)}">${escapeHtml(lang)}</button>`
    ),
  ];

  els.filterBar.innerHTML = buttons.join('');
  els.filterBar.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.languageFilter = tab.dataset.lang;
      renderLanguageFilters();
      renderMovies();
    });
  });
}

function renderMovies() {
  const filtered =
    state.languageFilter === 'ALL'
      ? state.movies
      : state.movies.filter((m) => m.language.toLowerCase() === state.languageFilter.toLowerCase());

  if (filtered.length === 0) {
    els.moviesGrid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">No movies found in the <code>movies</code> table.</div>`;
    return;
  }

  els.moviesGrid.innerHTML = filtered
    .map(
      (movie) => `
      <article class="movie-card">
        <div class="movie-poster-wrap">
          <img
            class="movie-poster-img"
            src="${escapeHtml(movie.poster_url)}"
            alt="${escapeHtml(movie.title)} movie poster"
            referrerpolicy="no-referrer"
            loading="lazy"
          />
          <div class="poster-fallback" hidden>${escapeHtml(movie.title)}</div>
          <div class="movie-poster-scrim" aria-hidden="true"></div>
          <span class="movie-cert-badge">${escapeHtml(movie.certification)} • ${movie.duration_minutes}m</span>
        </div>
        <div class="movie-card-body">
          <h2 class="movie-title">${escapeHtml(movie.title)}</h2>
          <p class="movie-meta-line">
            <span>${escapeHtml(movie.genre)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(movie.language)}</span>
          </p>
          <p class="movie-desc">${escapeHtml(movie.description)}</p>
          <button type="button" class="primary-btn full-width book-movie-btn" data-movie-id="${escapeHtml(movie.movie_id)}">
            Book Tickets
          </button>
        </div>
      </article>
    `
    )
    .join('');

  els.moviesGrid.querySelectorAll('.movie-poster-img').forEach((img) => {
    img.addEventListener('error', () => {
      img.hidden = true;
      const fallback = img.nextElementSibling;
      if (fallback) fallback.hidden = false;
    });
  });

  els.moviesGrid.querySelectorAll('.book-movie-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMovie(btn.dataset.movieId);
    });
  });
}

// ---------------------------------------------------------------------------
// Stage 2: Venue & Showtime Selection (`showtimes` table)
// ---------------------------------------------------------------------------

async function selectMovie(movieIdRaw) {
  const movie = state.movies.find((m) => String(m.movie_id) === String(movieIdRaw));
  if (!movie || !supabase) return;

  state.selectedMovie = movie;
  state.selectedShow = null;
  state.selectedSeatCodes.clear();
  goToStage(2);

  els.selectedMovieBanner.innerHTML = `
    <img
      class="summary-poster"
      src="${escapeHtml(movie.poster_url)}"
      alt="${escapeHtml(movie.title)}"
      referrerpolicy="no-referrer"
    />
    <div>
      <h1 class="summary-title">${escapeHtml(movie.title)}</h1>
      <div class="summary-meta">
        <span>${escapeHtml(movie.certification)}</span>
        <span aria-hidden="true">·</span>
        <span>${movie.duration_minutes} mins</span>
        <span aria-hidden="true">·</span>
        <span>${escapeHtml(movie.language)}</span>
        <span aria-hidden="true">·</span>
        <span>${escapeHtml(movie.genre)}</span>
      </div>
      <p class="summary-desc">${escapeHtml(movie.description)}</p>
    </div>
  `;

  els.theatersList.innerHTML = `<div class="empty-state">Loading showtimes from Supabase…</div>`;

  try {
    const { data: showRows, error } = await supabase
      .from('showtimes')
      .select('*')
      .eq('movie_id', movie.movie_id);

    if (error) throw new Error(error.message);

    const normalizedShows = (showRows || [])
      .map((r) => normalizeShowtime(r, movie))
      .filter((s) => String(s.status).toUpperCase() !== 'CANCELLED')
      .sort((a, b) => {
        const tCmp = a.theater_name.localeCompare(b.theater_name);
        if (tCmp !== 0) return tCmp;
        const dCmp = String(a.show_date).localeCompare(String(b.show_date));
        if (dCmp !== 0) return dCmp;
        return String(a.start_time).localeCompare(String(b.start_time));
      });

    // Compute live available seat counts from `bookings`
    const showIds = normalizedShows.map((s) => s.showtime_id);
    const bookedCountsByShow = new Map();

    if (showIds.length > 0) {
      let bookingRows = [];
      const bRes = await supabase.from('bookings').select('*').in('showtime_id', showIds);
      if (!bRes.error) {
        bookingRows = bRes.data || [];
      } else if (String(bRes.error.message || '').includes('showtime_id')) {
        const bFallback = await supabase.from('bookings').select('*').in('show_id', showIds);
        bookingRows = bFallback.data || [];
      }

      for (const b of bookingRows) {
        if (!isActiveBooking(b)) continue;
        const sid = String(b.showtime_id ?? b.show_id);
        const seats = extractSeatCodes(b);
        if (!bookedCountsByShow.has(sid)) bookedCountsByShow.set(sid, new Set());
        seats.forEach((code) => bookedCountsByShow.get(sid).add(code));
      }
    }

    state.shows = normalizedShows.map((s) => {
      const taken = bookedCountsByShow.get(String(s.showtime_id))?.size || 0;
      return {
        ...s,
        available_seats: Math.max(0, TOTAL_SEATS_PER_SHOW - taken),
      };
    });

    renderTheatersAndShows();
  } catch (err) {
    els.theatersList.innerHTML = `<div class="empty-state">Failed to fetch showtimes: ${escapeHtml(err.message)}</div>`;
  }
}

function renderTheatersAndShows() {
  if (state.shows.length === 0) {
    els.theatersList.innerHTML = `<div class="empty-state">No scheduled showtimes found in <code>showtimes</code> for this movie.</div>`;
    return;
  }

  const grouped = new Map();
  for (const show of state.shows) {
    const key = show.theater_name;
    if (!grouped.has(key)) {
      grouped.set(key, {
        theater_name: show.theater_name,
        theater_address: show.theater_address,
        shows: [],
      });
    }
    grouped.get(key).shows.push(show);
  }

  els.theatersList.innerHTML = Array.from(grouped.values())
    .map(
      (theater) => `
      <article class="theater-card glass-panel">
        <div class="theater-top">
          <div>
            <h3 class="theater-name">${escapeHtml(theater.theater_name)}</h3>
            <p class="theater-address">${escapeHtml(theater.theater_address)}</p>
          </div>
        </div>
        <div class="showtime-pills">
          ${theater.shows
            .map(
              (show) => `
            <button type="button" class="showtime-pill" data-show-id="${escapeHtml(show.showtime_id)}">
              <span class="showtime-main">${escapeHtml(show.start_time)} | ${escapeHtml(show.screen_type)} • ${formatINRCompact(show.base_price)}</span>
              <span class="showtime-sub">${escapeHtml(show.screen_name)} · ${escapeHtml(show.show_date)} · ${show.available_seats} seats free</span>
            </button>
          `
            )
            .join('')}
        </div>
      </article>
    `
    )
    .join('');

  els.theatersList.querySelectorAll('.showtime-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      selectShow(pill.dataset.showId);
    });
  });
}

// ---------------------------------------------------------------------------
// Stage 3: Interactive 60-Seat Auditorium Matrix (Derived from `bookings`)
// ---------------------------------------------------------------------------

async function selectShow(showtimeIdRaw) {
  const show = state.shows.find((s) => String(s.showtime_id) === String(showtimeIdRaw));
  if (!show) return;

  state.selectedShow = show;
  state.selectedSeatCodes.clear();
  goToStage(3);

  els.seatMatrix.innerHTML = `<div class="empty-state">Loading live seat availability from Supabase…</div>`;
  updateStickyBar();

  await refreshShowSeats(show.showtime_id);
}

async function refreshShowSeats(showtimeId) {
  try {
    const bookingRows = await fetchBookingsForShowtime(showtimeId);
    const bookedSet = new Set();

    for (const row of bookingRows) {
      if (!isActiveBooking(row)) continue;
      extractSeatCodes(row).forEach((code) => bookedSet.add(code));
    }

    state.seats = buildSeatMatrixModel(state.selectedShow.base_price, bookedSet);

    // Prune any selected seats that were booked concurrently
    for (const code of Array.from(state.selectedSeatCodes)) {
      if (bookedSet.has(code)) {
        state.selectedSeatCodes.delete(code);
      }
    }

    renderShowContextBar();
    renderSeatMatrix();
    updateStickyBar();
  } catch (err) {
    els.seatMatrix.innerHTML = `<div class="empty-state">Error loading seat bookings: ${escapeHtml(err.message)}</div>`;
  }
}

function renderShowContextBar() {
  const s = state.selectedShow;
  if (!s) return;
  els.showContextBar.innerHTML = `
    <div>
      <h2 class="context-title">${escapeHtml(s.movie_title)}</h2>
      <p class="context-meta">
        ${escapeHtml(s.theater_name)} · ${escapeHtml(s.screen_name)} (${escapeHtml(s.screen_type)}) · ${escapeHtml(s.show_date)} at ${escapeHtml(s.start_time)}
      </p>
    </div>
    <div class="context-meta">
      Base Price: <strong>${formatINRCompact(s.base_price)}</strong>
    </div>
  `;
}

function renderSeatMatrix() {
  const rowsMap = new Map();
  for (const seat of state.seats) {
    if (!rowsMap.has(seat.row_label)) {
      rowsMap.set(seat.row_label, []);
    }
    rowsMap.get(seat.row_label).push(seat);
  }

  const tierHeaders = {
    A: 'STANDARD',
    C: 'PREMIUM',
    E: 'VIP',
  };

  let html = '';

  for (const rowLabel of ROW_ORDER) {
    const rowSeats = rowsMap.get(rowLabel) || [];
    if (rowSeats.length === 0) continue;

    if (tierHeaders[rowLabel]) {
      const tierPrice = formatINRCompact(rowSeats[0].seat_price);
      html += `<div class="tier-divider">${tierHeaders[rowLabel]} · ${tierPrice}</div>`;
    }

    const leftSeats = rowSeats.filter((s) => s.seat_number <= 5);
    const rightSeats = rowSeats.filter((s) => s.seat_number >= 6);

    const renderSeatBtn = (seat) => {
      const isBooked = seat.status === 'BOOKED';
      const isSelected = state.selectedSeatCodes.has(seat.seat_code);
      const cls = isBooked ? 'booked' : isSelected ? 'selected' : 'available';
      const title = isBooked
        ? `${seat.seat_code} — Booked`
        : `${seat.seat_code} (${seat.seat_type}) — ${formatINRCompact(seat.seat_price)}`;

      return `
        <button
          type="button"
          class="seat-btn ${cls}"
          data-seat-code="${escapeHtml(seat.seat_code)}"
          title="${escapeHtml(title)}"
          aria-label="${escapeHtml(title)}"
          aria-pressed="${isSelected ? 'true' : 'false'}"
          ${isBooked ? 'disabled' : ''}
        >
          ${escapeHtml(seat.seat_code)}
        </button>
      `;
    };

    html += `
      <div class="seat-row">
        <span class="row-label" aria-hidden="true">${rowLabel}</span>
        <div class="seat-group">${leftSeats.map(renderSeatBtn).join('')}</div>
        <div class="aisle-gap" aria-hidden="true"></div>
        <div class="seat-group">${rightSeats.map(renderSeatBtn).join('')}</div>
        <span class="row-label" aria-hidden="true">${rowLabel}</span>
      </div>
    `;
  }

  els.seatMatrix.innerHTML = html;

  els.seatMatrix.querySelectorAll('.seat-btn:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleSeat(btn.dataset.seatCode);
    });
  });
}

function toggleSeat(seatCode) {
  if (state.selectedSeatCodes.has(seatCode)) {
    state.selectedSeatCodes.delete(seatCode);
  } else {
    if (state.selectedSeatCodes.size >= state.maxSeats) {
      showToast(`Maximum ${state.maxSeats} seats allowed per booking.`, 'error');
      return;
    }
    state.selectedSeatCodes.add(seatCode);
  }

  els.seatMatrix.querySelectorAll('.seat-btn:not(:disabled)').forEach((btn) => {
    const active = state.selectedSeatCodes.has(btn.dataset.seatCode);
    btn.classList.toggle('selected', active);
    btn.classList.toggle('available', !active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  updateStickyBar();
}

function computeSelectedSummary() {
  const selectedCodes = Array.from(state.selectedSeatCodes).sort((a, b) => {
    const rowDiff = a.charCodeAt(0) - b.charCodeAt(0);
    if (rowDiff !== 0) return rowDiff;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
  const seatMap = new Map(state.seats.map((s) => [s.seat_code, s]));
  const subtotal = selectedCodes.reduce((sum, code) => {
    const seat = seatMap.get(code);
    return sum + (seat ? Number(seat.seat_price) : 0);
  }, 0);

  return {
    selectedCodes,
    subtotal: Number(subtotal.toFixed(2)),
    convenienceFee: state.convenienceFee,
    grandTotal: Number((subtotal + (selectedCodes.length > 0 ? state.convenienceFee : 0)).toFixed(2)),
  };
}

function updateStickyBar() {
  const { selectedCodes, subtotal } = computeSelectedSummary();
  const count = selectedCodes.length;

  if (count === 0) {
    els.stickySeatsText.textContent = `None selected (0 / ${state.maxSeats})`;
    els.stickyTotalText.textContent = formatINR(0);
    els.proceedCheckoutBtn.disabled = true;
  } else {
    els.stickySeatsText.textContent = `${count} ${count === 1 ? 'Seat' : 'Seats'} · ${selectedCodes.join(', ')}`;
    els.stickyTotalText.textContent = formatINR(subtotal);
    els.proceedCheckoutBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Stage 4A: Checkout Modal & Supabase `bookings` Insert
// ---------------------------------------------------------------------------

function openCheckoutModal() {
  const { selectedCodes, subtotal, convenienceFee, grandTotal } = computeSelectedSummary();
  const show = state.selectedShow;
  if (!show || selectedCodes.length === 0) return;

  els.checkoutErrorMsg.hidden = true;
  els.checkoutErrorMsg.textContent = '';

  els.checkoutSummary.innerHTML = `
    <div class="summary-line">
      <span>Movie</span>
      <strong>${escapeHtml(show.movie_title)}</strong>
    </div>
    <div class="summary-line">
      <span>Venue &amp; Showtime</span>
      <strong>${escapeHtml(show.theater_name)} · ${escapeHtml(show.start_time)}</strong>
    </div>
    <div class="summary-line">
      <span>Screen / Format</span>
      <strong>${escapeHtml(show.screen_name)} (${escapeHtml(show.screen_type)})</strong>
    </div>
    <div class="summary-line">
      <span>Selected Seats (${selectedCodes.length})</span>
      <strong>${escapeHtml(selectedCodes.join(', '))}</strong>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-line">
      <span>Tickets Subtotal</span>
      <strong>${formatINR(subtotal)}</strong>
    </div>
    <div class="summary-line">
      <span>Convenience Fee</span>
      <strong>${formatINR(convenienceFee)}</strong>
    </div>
    <div class="summary-divider"></div>
    <div class="summary-line summary-grand">
      <span>Grand Total</span>
      <strong>${formatINR(grandTotal)}</strong>
    </div>
  `;

  els.checkoutModal.hidden = false;
  document.getElementById('customer-name').focus();
}

function closeCheckoutModal() {
  els.checkoutModal.hidden = true;
}

async function handleCheckoutSubmit(event) {
  event.preventDefault();
  els.checkoutErrorMsg.hidden = true;

  if (!supabase) {
    showCheckoutError('Supabase is not configured.');
    return;
  }

  const customerName = document.getElementById('customer-name').value.trim();
  const customerEmail = document.getElementById('customer-email').value.trim();
  const customerPhone = document.getElementById('customer-phone').value.replace(/[\s\-()]/g, '').trim();

  if (customerName.length < 2) {
    showCheckoutError('Please enter your full name (at least 2 characters).');
    return;
  }
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(customerEmail)) {
    showCheckoutError('Please enter a valid email address.');
    return;
  }
  if (!/^\+?\d{10,14}$/.test(customerPhone)) {
    showCheckoutError('Please enter a valid 10-digit phone number.');
    return;
  }

  const { selectedCodes, subtotal, convenienceFee, grandTotal } = computeSelectedSummary();
  const show = state.selectedShow;
  if (selectedCodes.length === 0 || !show) {
    showCheckoutError('No seats selected.');
    return;
  }

  els.confirmBookingBtn.disabled = true;
  els.confirmBookingBtn.textContent = 'Saving to Supabase…';

  try {
    // Re-check active bookings right before inserting to catch concurrent seat reservations
    const latestBookings = await fetchBookingsForShowtime(show.showtime_id);
    const bookedSet = new Set();
    for (const row of latestBookings) {
      if (!isActiveBooking(row)) continue;
      extractSeatCodes(row).forEach((c) => bookedSet.add(c));
    }

    const conflicts = selectedCodes.filter((code) => bookedSet.has(code));
    if (conflicts.length > 0) {
      showCheckoutError(`Seats already booked: ${conflicts.join(', ')}. Seat map has been refreshed.`);
      await refreshShowSeats(show.showtime_id);
      return;
    }

    const bookingReference = generateBookingReference();
    const record = {
      booking_reference: bookingReference,
      showtime_id: show.showtime_id,
      seat_codes: selectedCodes,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      tickets_subtotal: subtotal,
      convenience_fee: convenienceFee,
      total_amount: grandTotal,
      booking_status: 'CONFIRMED',
    };

    const { data: inserted, error } = await supabase
      .from('bookings')
      .insert([record])
      .select()
      .single();

    if (error) {
      if (String(error.message || '').includes('Seats already booked') || error.code === '23505') {
        showCheckoutError(`${error.message}. Seat map has been refreshed.`);
        await refreshShowSeats(show.showtime_id);
        return;
      }
      throw new Error(error.message);
    }

    const confirmedBooking = {
      booking_id: inserted?.id ?? inserted?.booking_id,
      booking_reference: inserted?.booking_reference || bookingReference,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      showtime_id: show.showtime_id,
      movie_title: show.movie_title,
      theater_name: show.theater_name,
      theater_address: show.theater_address,
      screen_name: show.screen_name,
      screen_type: show.screen_type,
      show_date: show.show_date,
      start_time: show.start_time,
      seat_codes: selectedCodes,
      tickets_subtotal: subtotal,
      convenience_fee: convenienceFee,
      total_amount: grandTotal,
      booking_status: inserted?.booking_status || 'CONFIRMED',
    };

    state.latestBooking = confirmedBooking;
    state.selectedSeatCodes.clear();
    closeCheckoutModal();
    els.checkoutForm.reset();
    renderBoardingPass(confirmedBooking);
    goToStage(4);
    showToast(`Booking ${confirmedBooking.booking_reference} saved to Supabase!`, 'success');
  } catch (err) {
    showCheckoutError(err.message);
  } finally {
    els.confirmBookingBtn.disabled = false;
    els.confirmBookingBtn.textContent = 'Confirm & Pay';
  }
}

function showCheckoutError(msg) {
  els.checkoutErrorMsg.textContent = msg;
  els.checkoutErrorMsg.hidden = false;
}

// ---------------------------------------------------------------------------
// Stage 4B: Digital Boarding Pass & Deterministic SVG QR Code
// ---------------------------------------------------------------------------

function generateDeterministicQrSvg(seedText) {
  const size = 21;
  let hash = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    hash ^= seedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const isFinder = (r, c) => {
    const inTopLeft = r < 7 && c < 7;
    const inTopRight = r < 7 && c >= size - 7;
    const inBottomLeft = r >= size - 7 && c < 7;
    if (!inTopLeft && !inTopRight && !inBottomLeft) return null;

    const lr = r >= size - 7 ? r - (size - 7) : r;
    const lc = c >= size - 7 ? c - (size - 7) : c;
    if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
    if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
    return false;
  };

  let rects = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const finder = isFinder(r, c);
      let dark = false;
      if (finder !== null) {
        dark = finder;
      } else {
        const bitSeed = (hash ^ (r * 31 + c * 17)) >>> 0;
        dark = ((bitSeed * 2654435761) >>> 28) % 2 === 0;
      }
      if (dark) {
        rects += `<rect x="${c * 6}" y="${r * 6}" width="6" height="6" fill="#090a0f" />`;
      }
    }
  }

  const dim = size * 6;
  return `<svg width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" role="img" aria-label="QR verification code for ${escapeHtml(seedText)}">${rects}</svg>`;
}

function renderBoardingPass(booking) {
  const isCancelled = booking.booking_status === 'CANCELLED';
  const qrSvg = generateDeterministicQrSvg(
    `${booking.booking_reference}|${booking.showtime_id}|${booking.seat_codes.join(',')}`
  );

  els.boardingPassCard.innerHTML = `
    <div class="boarding-main">
      <div class="boarding-ref-row">
        <span class="boarding-ref">${escapeHtml(booking.booking_reference)}</span>
        <span class="boarding-status ${isCancelled ? 'cancelled' : ''}">${escapeHtml(booking.booking_status)}</span>
      </div>
      <h2 class="boarding-movie">${escapeHtml(booking.movie_title)}</h2>
      <p class="boarding-theater">${escapeHtml(booking.theater_name)}${booking.theater_address ? ` · ${escapeHtml(booking.theater_address)}` : ''}</p>

      <div class="boarding-details-grid">
        <div class="detail-cell">
          <span>Show Date &amp; Time</span>
          <strong>${escapeHtml(booking.show_date)} · ${escapeHtml(booking.start_time)}</strong>
        </div>
        <div class="detail-cell">
          <span>Screen &amp; Format</span>
          <strong>${escapeHtml(booking.screen_name)} (${escapeHtml(booking.screen_type)})</strong>
        </div>
        <div class="detail-cell">
          <span>Booked Seats</span>
          <strong>${escapeHtml(booking.seat_codes.join(', '))}</strong>
        </div>
        <div class="detail-cell">
          <span>Total Paid (incl. ₹30 fee)</span>
          <strong>${formatINR(booking.total_amount)}</strong>
        </div>
        <div class="detail-cell">
          <span>Guest Name</span>
          <strong>${escapeHtml(booking.customer_name)}</strong>
        </div>
        <div class="detail-cell">
          <span>Contact</span>
          <strong>${escapeHtml(booking.customer_phone)}</strong>
        </div>
      </div>
    </div>

    <div class="boarding-stub">
      <div class="qr-frame">${qrSvg}</div>
      <span class="qr-caption">SCAN AT GATE<br />${escapeHtml(booking.booking_reference)}</span>
    </div>
  `;

  els.cancelCurrentTicketBtn.disabled = isCancelled;
  els.cancelCurrentTicketBtn.textContent = isCancelled ? 'Booking Cancelled' : 'Cancel This Booking';
}

async function handleCancelCurrentBooking() {
  if (!supabase || !state.latestBooking || state.latestBooking.booking_status === 'CANCELLED') return;
  els.cancelCurrentTicketBtn.disabled = true;

  try {
    const { error } = await supabase
      .from('bookings')
      .update({ booking_status: 'CANCELLED' })
      .eq('booking_reference', state.latestBooking.booking_reference);

    if (error) throw new Error(error.message);

    state.latestBooking.booking_status = 'CANCELLED';
    renderBoardingPass(state.latestBooking);
    showToast(
      `Booking ${state.latestBooking.booking_reference} cancelled. Seats released back to AVAILABLE.`,
      'info'
    );
  } catch (err) {
    showToast(err.message, 'error');
    els.cancelCurrentTicketBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// My Bookings Modal (Lookup & Cancel in Supabase `bookings`)
// ---------------------------------------------------------------------------

async function openBookingsModal(reference = '') {
  els.bookingsModal.hidden = false;

  if (!supabase) {
    els.bookingsList.innerHTML = `<div class="empty-state">Supabase is not configured.</div>`;
    return;
  }

  els.bookingsList.innerHTML = `<div class="empty-state">Fetching bookings from Supabase…</div>`;

  try {
    let query = supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(25);
    if (reference) {
      query = supabase.from('bookings').select('*').ilike('booking_reference', reference);
    }

    const { data: bookingRows, error } = await query;
    if (error) throw new Error(error.message);

    const rows = bookingRows || [];
    if (rows.length === 0) {
      els.bookingsList.innerHTML = `<div class="empty-state">No matching bookings found in Supabase.</div>`;
      return;
    }

    // Fetch related showtimes & movies cleanly without assuming constraint names
    const showIds = Array.from(new Set(rows.map((r) => r.showtime_id ?? r.show_id).filter(Boolean)));
    const showMap = new Map();
    if (showIds.length > 0) {
      const { data: showRows } = await supabase.from('showtimes').select('*').in('id', showIds);
      for (const s of showRows || []) {
        showMap.set(String(s.id ?? s.showtime_id), s);
      }
    }

    const movieMap = new Map(state.movies.map((m) => [String(m.movie_id), m]));

    const enriched = rows.map((b) => {
      const showRow = showMap.get(String(b.showtime_id ?? b.show_id));
      const movie = showRow ? movieMap.get(String(showRow.movie_id)) : null;
      return {
        booking_reference: b.booking_reference,
        booking_status: b.booking_status || 'CONFIRMED',
        seat_codes: extractSeatCodes(b).join(', '),
        total_amount: b.total_amount ?? 0,
        movie_title: movie?.title || 'Movie Booking',
        theater_name: showRow?.theater_name || 'Theater',
        show_date: showRow?.show_date || '',
        start_time: showRow?.start_time || '',
      };
    });

    renderBookingsList(enriched);
  } catch (err) {
    els.bookingsList.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderBookingsList(bookings) {
  els.bookingsList.innerHTML = bookings
    .map((b) => {
      const cancelled = b.booking_status === 'CANCELLED';
      return `
        <div class="booking-history-item">
          <div class="booking-history-main">
            <h4>${escapeHtml(b.movie_title)} · <span class="boarding-ref">${escapeHtml(b.booking_reference)}</span></h4>
            <p class="booking-history-meta">
              ${escapeHtml(b.theater_name)}${b.show_date ? ` · ${escapeHtml(b.show_date)} ${escapeHtml(b.start_time)}` : ''} · Seats: ${escapeHtml(b.seat_codes || 'None')} · ${formatINR(b.total_amount)}
            </p>
          </div>
          <div class="booking-history-actions">
            <span class="boarding-status ${cancelled ? 'cancelled' : ''}">${escapeHtml(b.booking_status)}</span>
            ${
              cancelled
                ? ''
                : `<button type="button" class="secondary-btn cancel-history-btn" data-ref="${escapeHtml(b.booking_reference)}">Cancel</button>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  els.bookingsList.querySelectorAll('.cancel-history-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ref = btn.dataset.ref;
      btn.disabled = true;
      try {
        const { error } = await supabase
          .from('bookings')
          .update({ booking_status: 'CANCELLED' })
          .eq('booking_reference', ref);

        if (error) throw new Error(error.message);

        showToast(`Booking ${ref} cancelled and seats released.`, 'success');
        await openBookingsModal(els.bookingRefInput.value.trim());
        if (state.stage === 3 && state.selectedShow) {
          await refreshShowSeats(state.selectedShow.showtime_id);
        }
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Event Wiring & Initialization
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById('brand-home-btn').addEventListener('click', () => goToStage(1));
  document.getElementById('nav-movies-btn').addEventListener('click', () => goToStage(1));
  document.getElementById('nav-bookings-btn').addEventListener('click', () => openBookingsModal());

  els.stepTriggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.dataset.stepTarget);
      if (target < state.stage) {
        goToStage(target);
      }
    });
  });

  document.getElementById('back-to-movies-btn').addEventListener('click', () => goToStage(1));
  document.getElementById('back-to-shows-btn').addEventListener('click', () => goToStage(2));

  els.proceedCheckoutBtn.addEventListener('click', openCheckoutModal);
  document.getElementById('close-checkout-btn').addEventListener('click', closeCheckoutModal);
  document.getElementById('cancel-checkout-btn').addEventListener('click', closeCheckoutModal);
  els.checkoutForm.addEventListener('submit', handleCheckoutSubmit);

  els.cancelCurrentTicketBtn.addEventListener('click', handleCancelCurrentBooking);
  document.getElementById('book-another-btn').addEventListener('click', () => {
    state.selectedMovie = null;
    state.selectedShow = null;
    state.selectedSeatCodes.clear();
    goToStage(1);
    loadMovies();
  });

  document.getElementById('close-bookings-btn').addEventListener('click', () => {
    els.bookingsModal.hidden = true;
  });
  els.bookingSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    openBookingsModal(els.bookingRefInput.value.trim());
  });
  document.getElementById('reset-bookings-search-btn').addEventListener('click', () => {
    els.bookingRefInput.value = '';
    openBookingsModal('');
  });

  [els.checkoutModal, els.bookingsModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.checkoutModal.hidden = true;
      els.bookingsModal.hidden = true;
    }
  });
}

async function init() {
  bindEvents();
  await checkSupabaseHealth();
  await loadMovies();
}

init();
