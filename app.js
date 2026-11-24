/**
 * CineVault — Online Movie Ticket Booking System (ES6+ Vanilla JS SPA)
 * Communicates with the Python 3 + SQLite REST API via fetch()
 */

const state = {
  stage: 1, // 1: Movies, 2: Shows, 3: Seats, 4: Ticket
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
  filterTabs: document.querySelectorAll('.filter-tab'),

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
// API Helpers
// ---------------------------------------------------------------------------

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const err = new Error(payload.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function checkDatabaseHealth() {
  try {
    const data = await apiRequest('/api/health');
    if (data.status === 'ok') {
      els.dbPill.classList.remove('offline');
      els.dbStatusText.textContent = 'Connected to Database (Live API)';
      return true;
    }
  } catch {
    // Handled below
  }
  els.dbPill.classList.add('offline');
  els.dbStatusText.textContent = 'Database Offline';
  return false;
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
// Stage 1: Movie Catalog
// ---------------------------------------------------------------------------

async function loadMovies() {
  els.moviesGrid.innerHTML = `<div class="empty-state">Loading active movies from SQLite database…</div>`;
  try {
    const data = await apiRequest('/api/movies');
    state.movies = data.movies || [];
    renderMovies();
  } catch (err) {
    els.moviesGrid.innerHTML = `<div class="empty-state">Unable to load movies: ${escapeHtml(err.message)}</div>`;
  }
}

function renderMovies() {
  const filtered =
    state.languageFilter === 'ALL'
      ? state.movies
      : state.movies.filter((m) => m.language.toLowerCase() === state.languageFilter.toLowerCase());

  if (filtered.length === 0) {
    els.moviesGrid.innerHTML = `<div class="empty-state">No movies found for ${escapeHtml(state.languageFilter)}.</div>`;
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
          <button type="button" class="primary-btn full-width book-movie-btn" data-movie-id="${movie.movie_id}">
            Book Tickets
          </button>
        </div>
      </article>
    `
    )
    .join('');

  // Resilient image error fallback
  els.moviesGrid.querySelectorAll('.movie-poster-img').forEach((img) => {
    img.addEventListener('error', () => {
      img.hidden = true;
      const fallback = img.nextElementSibling;
      if (fallback) fallback.hidden = false;
    });
  });

  els.moviesGrid.querySelectorAll('.book-movie-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const movieId = Number(btn.dataset.movieId);
      selectMovie(movieId);
    });
  });
}

// ---------------------------------------------------------------------------
// Stage 2: Venue & Showtime Selection
// ---------------------------------------------------------------------------

async function selectMovie(movieId) {
  const movie = state.movies.find((m) => m.movie_id === movieId);
  if (!movie) return;

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

  els.theatersList.innerHTML = `<div class="empty-state">Querying theater schedules…</div>`;

  try {
    const data = await apiRequest(`/api/shows?movie_id=${movieId}`);
    state.shows = data.shows || [];
    renderTheatersAndShows();
  } catch (err) {
    els.theatersList.innerHTML = `<div class="empty-state">Failed to fetch showtimes: ${escapeHtml(err.message)}</div>`;
  }
}

function renderTheatersAndShows() {
  if (state.shows.length === 0) {
    els.theatersList.innerHTML = `<div class="empty-state">No scheduled showtimes available for this title.</div>`;
    return;
  }

  // Group shows by theater_id
  const grouped = new Map();
  for (const show of state.shows) {
    if (!grouped.has(show.theater_id)) {
      grouped.set(show.theater_id, {
        theater_name: show.theater_name,
        theater_city: show.theater_city,
        theater_address: show.theater_address,
        shows: [],
      });
    }
    grouped.get(show.theater_id).shows.push(show);
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
            <button type="button" class="showtime-pill" data-show-id="${show.show_id}">
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
      const showId = Number(pill.dataset.showId);
      selectShow(showId);
    });
  });
}

// ---------------------------------------------------------------------------
// Stage 3: Interactive 60-Seat Auditorium Matrix
// ---------------------------------------------------------------------------

async function selectShow(showId) {
  state.selectedSeatCodes.clear();
  goToStage(3);

  els.seatMatrix.innerHTML = `<div class="empty-state">Loading live 60-seat auditorium inventory…</div>`;
  updateStickyBar();

  await refreshShowSeats(showId);
}

async function refreshShowSeats(showId) {
  try {
    const data = await apiRequest(`/api/show-seats?show_id=${showId}`);
    state.selectedShow = data.show;
    state.seats = data.seats || [];
    state.convenienceFee = Number(data.convenience_fee ?? 30);
    state.maxSeats = Number(data.max_seats ?? 6);

    // Prune any selected seats that became booked concurrently
    const seatByCode = new Map(state.seats.map((s) => [s.seat_code, s]));
    for (const code of Array.from(state.selectedSeatCodes)) {
      const seat = seatByCode.get(code);
      if (!seat || seat.status === 'BOOKED') {
        state.selectedSeatCodes.delete(code);
      }
    }

    renderShowContextBar();
    renderSeatMatrix();
    updateStickyBar();
  } catch (err) {
    els.seatMatrix.innerHTML = `<div class="empty-state">Error loading seats: ${escapeHtml(err.message)}</div>`;
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

  const rowOrder = ['A', 'B', 'C', 'D', 'E', 'F'];
  const tierHeaders = {
    A: 'STANDARD',
    C: 'PREMIUM',
    E: 'VIP',
  };

  let html = '';

  for (const rowLabel of rowOrder) {
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

  // Update button states directly without rebuilding full DOM
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
    subtotal,
    convenienceFee: state.convenienceFee,
    grandTotal: subtotal + (selectedCodes.length > 0 ? state.convenienceFee : 0),
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
// Stage 4A: Checkout Modal & Atomic Booking Submission
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

  const { selectedCodes } = computeSelectedSummary();
  if (selectedCodes.length === 0 || !state.selectedShow) {
    showCheckoutError('No seats selected.');
    return;
  }

  els.confirmBookingBtn.disabled = true;
  els.confirmBookingBtn.textContent = 'Locking Seats…';

  try {
    const result = await apiRequest('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        show_id: state.selectedShow.show_id,
        seat_codes: selectedCodes,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      }),
    });

    state.latestBooking = result.booking;
    state.selectedSeatCodes.clear();
    closeCheckoutModal();
    els.checkoutForm.reset();
    renderBoardingPass(result.booking);
    goToStage(4);
    showToast(`Booking ${result.booking.booking_reference} confirmed!`, 'success');
  } catch (err) {
    if (err.status === 409) {
      showCheckoutError(`${err.message}. Seat map has been refreshed.`);
      await refreshShowSeats(state.selectedShow.show_id);
    } else {
      showCheckoutError(err.message);
    }
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
  for (let i = 0; i < seedText.length; i++) {
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
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
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
  const qrSvg = generateDeterministicQrSvg(`${booking.booking_reference}|${booking.show_id}|${booking.seat_codes.join(',')}`);

  els.boardingPassCard.innerHTML = `
    <div class="boarding-main">
      <div class="boarding-ref-row">
        <span class="boarding-ref">${escapeHtml(booking.booking_reference)}</span>
        <span class="boarding-status ${isCancelled ? 'cancelled' : ''}">${escapeHtml(booking.booking_status)}</span>
      </div>
      <h2 class="boarding-movie">${escapeHtml(booking.movie_title)}</h2>
      <p class="boarding-theater">${escapeHtml(booking.theater_name)} · ${escapeHtml(booking.theater_address || '')}</p>

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
  if (!state.latestBooking || state.latestBooking.booking_status === 'CANCELLED') return;
  els.cancelCurrentTicketBtn.disabled = true;

  try {
    const res = await apiRequest('/api/bookings/cancel', {
      method: 'POST',
      body: JSON.stringify({ booking_reference: state.latestBooking.booking_reference }),
    });
    state.latestBooking.booking_status = 'CANCELLED';
    renderBoardingPass(state.latestBooking);
    showToast(`Booking ${res.booking_reference} cancelled. Seats released: ${res.released_seats.join(', ')}`, 'info');
  } catch (err) {
    showToast(err.message, 'error');
    els.cancelCurrentTicketBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// My Bookings Modal (Lookup & Cancel)
// ---------------------------------------------------------------------------

async function openBookingsModal(reference = '') {
  els.bookingsModal.hidden = false;
  els.bookingsList.innerHTML = `<div class="empty-state">Fetching bookings from SQLite…</div>`;
  try {
    const url = reference
      ? `/api/bookings?reference=${encodeURIComponent(reference)}`
      : '/api/bookings';
    const data = await apiRequest(url);
    renderBookingsList(data.bookings || []);
  } catch (err) {
    els.bookingsList.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderBookingsList(bookings) {
  if (bookings.length === 0) {
    els.bookingsList.innerHTML = `<div class="empty-state">No matching bookings found in database.</div>`;
    return;
  }

  els.bookingsList.innerHTML = bookings
    .map((b) => {
      const cancelled = b.booking_status === 'CANCELLED';
      return `
        <div class="booking-history-item">
          <div class="booking-history-main">
            <h4>${escapeHtml(b.movie_title)} · <span class="boarding-ref">${escapeHtml(b.booking_reference)}</span></h4>
            <p class="booking-history-meta">
              ${escapeHtml(b.theater_name)} · ${escapeHtml(b.show_date)} ${escapeHtml(b.start_time)} · Seats: ${escapeHtml(b.seat_codes || 'Released')} · ${formatINR(b.total_amount)}
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
        const res = await apiRequest('/api/bookings/cancel', {
          method: 'POST',
          body: JSON.stringify({ booking_reference: ref }),
        });
        showToast(`Released seats (${res.released_seats.join(', ')}) for ${ref}`, 'success');
        await openBookingsModal(els.bookingRefInput.value.trim());
        if (state.stage === 3 && state.selectedShow) {
          await refreshShowSeats(state.selectedShow.show_id);
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

  els.filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.filterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.languageFilter = tab.dataset.lang;
      renderMovies();
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

  // Close modals on backdrop click or Escape
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
  await checkDatabaseHealth();
  await loadMovies();
}

init();
