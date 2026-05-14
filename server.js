const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const AppleStrategy = require('passport-apple');
require('dotenv').config();

const { google } = require('googleapis');
//  crypto for generating secure reference numbers
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// ── Nodemailer transporter ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.HOTEL_EMAIL,
    pass: process.env.HOTEL_PASSWORD,
  },
});

// --- GOOGLE CALENDAR SETUP ---
let calendar;
try {
  const auth = new google.auth.GoogleAuth({
    keyFile: './google-credentials.json', 
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  });
  calendar = google.calendar({ version: 'v3', auth });
} catch (err) {
  console.log("Google Calendar not configured. Please check your JSON file.");
}

// 🟢 MAKE SURE THIS IS YOUR ACTUAL GMAIL ADDRESS
const CALENDAR_ID = process.env.HOTEL_EMAIL || 'airportgrande@gmail.com';

// ── SSE: connected admin clients ──
let adminClients = [];

const app = express();
const PORT = process.env.PORT || 5000; // Assuming you changed this to 5000 earlier!

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(passport.initialize());

// Database Setup
const db = new Database('airport_grande.db');

const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY;
let currentExchangeRate = 15; // Fallback rate

async function fetchLiveExchangeRate() {
  if (!EXCHANGE_API_KEY) {
    console.log("No Exchange API Key found. Using fallback rate of 15.");
    return;
  }
  try {
    const response = await fetch(`https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/pair/USD/GHS`);
    const data = await response.json();
    if (data.result === 'success') {
      currentExchangeRate = data.conversion_rate;
      console.log(`Live Exchange Rate Updated: $1 USD = ${currentExchangeRate} GHS`);
    }
  } catch (error) {
    console.error('Failed to connect to Exchange API. Using fallback rate.', error);
  }
}

// Fetch immediately, then every 1 hour
fetchLiveExchangeRate();
setInterval(fetchLiveExchangeRate, 60 * 60 * 1000);

// Server-side pricing (Safe from frontend tampering)
const ROOM_PRICES = {
  'Apartment': 100,
  'Room': 50
};
// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT,
    google_id TEXT UNIQUE,
    apple_id TEXT UNIQUE,
    role TEXT DEFAULT 'client',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'available'
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id INTEGER,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    special_requests TEXT,
    payment_reference TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Migration: Add payment_reference if it doesn't exist
try {
  db.prepare("ALTER TABLE bookings ADD COLUMN payment_reference TEXT").run();
} catch (e) {
  // Column already exists or table doesn't exist yet
}

// Seed Rooms if empty
const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get();
if (roomCount.count === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (id, name, type) VALUES (?, ?, ?)');
  
  // 8 Apartments
  for (let i = 1; i <= 8; i++) {
    insertRoom.run(`apt-${i}`, `Apartment ${i}`, 'Apartment');
  }
  // 6 Rooms
  for (let i = 1; i <= 6; i++) {
    insertRoom.run(`room-${i}`, `Room ${i}`, 'Room');
  }
  console.log('Database seeded with rooms.');
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_secret_for_dev';

// Passport Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: "/api/auth/google/callback"
  },
  (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(profile.id, email);
      if (!user) {
        const stmt = db.prepare('INSERT INTO users (name, email, google_id) VALUES (?, ?, ?)');
        const info = stmt.run(profile.displayName, email, profile.id);
        user = { id: info.lastInsertRowid, name: profile.displayName, email: email, role: 'client' };
      } else if (!user.google_id) {
        db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(profile.id, user.id);
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Passport Apple Strategy
passport.use(new AppleStrategy({
    clientID: process.env.APPLE_CLIENT_ID || 'dummy',
    teamID: process.env.APPLE_TEAM_ID || 'dummy',
    keyID: process.env.APPLE_KEY_ID || 'dummy',
    privateKeyLocation: process.env.APPLE_PRIVATE_KEY_PATH || 'dummy.p8',
    callbackURL: "/api/auth/apple/callback"
  },
  (req, accessToken, refreshToken, idToken, profile, done) => {
    try {
      const appleId = idToken.sub;
      let user = db.prepare('SELECT * FROM users WHERE apple_id = ? OR email = ?').get(appleId, profile?.email);
      if (!user) {
        const name = profile ? `${profile.name.firstName} ${profile.name.lastName}` : 'Apple User';
        const stmt = db.prepare('INSERT INTO users (name, email, apple_id) VALUES (?, ?, ?)');
        const info = stmt.run(name, profile?.email, appleId);
        user = { id: info.lastInsertRowid, name, email: profile?.email, role: 'client' };
      } else if (!user.apple_id) {
        db.prepare('UPDATE users SET apple_id = ? WHERE id = ?').run(appleId, user.id);
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Auth Routes
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/api/auth/google/callback', passport.authenticate('google', { session: false }), (req, res) => {
  const token = jwt.sign({ id: req.user.id, email: req.user.email, role: req.user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.redirect(`/login.html?token=${token}&user=${encodeURIComponent(JSON.stringify(req.user))}`);
});

app.get('/api/auth/apple', passport.authenticate('apple'));
app.post('/api/auth/apple/callback', passport.authenticate('apple', { session: false }), (req, res) => {
  const token = jwt.sign({ id: req.user.id, email: req.user.email, role: req.user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.redirect(`/login.html?token=${token}&user=${encodeURIComponent(JSON.stringify(req.user))}`);
});

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};

// Middleware to check Admin role
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Forbidden. Admin access required.' });
  }
};

// API: User Signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    // Auto-promote any @airportgrande.com email to admin
    const role = email.endsWith('@airportgrande.com') ? 'admin' : 'client';
    
    const stmt = db.prepare('INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(name, email, phone, hashedPassword, role);
    
    const token = jwt.sign({ id: info.lastInsertRowid, email, role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, user: { id: info.lastInsertRowid, name, email, role } });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, message: 'Email already exists.' });
    }
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// API: User Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// API: Check Availability Only
app.get('/api/check-availability', (req, res) => {
  const { roomId, checkIn, checkOut } = req.query;

  if (!roomId || !checkIn || !checkOut) {
    return res.status(400).json({ success: false, message: 'Missing parameters.' });
  }

  try {
    const conflict = db.prepare(`
      SELECT id FROM bookings 
      WHERE room_id = ? 
      AND status != 'cancelled'
      AND (
        (check_in <= ? AND check_out > ?) OR
        (check_in < ? AND check_out >= ?) OR
        (? <= check_in AND ? > check_in)
      )
    `).get(roomId, checkIn, checkIn, checkOut, checkOut, checkIn, checkOut);

    if (conflict) {
      return res.json({ success: false, available: false, message: 'Room is already booked for these dates.' });
    }

    res.json({ success: true, available: true });
  } catch (error) {
    console.error('Availability check error:', error);
    res.status(500).json({ success: false, message: 'Server error checking availability.' });
  }
});


app.post('/api/init-payment', (req, res) => {
  const { roomId, roomType, checkIn, checkOut } = req.body;

  try {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const diffTime = Math.abs(checkOutDate - checkInDate);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const pricePerNightUSD = ROOM_PRICES[roomType] || 50;
    const totalUSD = nights * pricePerNightUSD;
    
    const totalGHS = totalUSD * currentExchangeRate; 
    const totalKobo = Math.round(totalGHS * 100);

    const reference = `AG-${crypto.randomUUID()}`;

    res.json({ success: true, amountToCharge: totalKobo, reference });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to calculate pricing.' });
  }
});

// API: Check Availability & Book
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY; // <-- Make sure this line is here!

// API: Direct Booking (No Paystack) + Email Ticket
app.post('/api/book', async (req, res) => {
  const { name, email, phone, checkIn, checkOut, roomId, roomLabel, specialRequests, userId } = req.body;

  if (!name || !email || !phone || !checkIn || !checkOut || !roomId) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    // 1. Final Availability Check (Prevent double-booking)
    const conflict = db.prepare(`
      SELECT id FROM bookings 
      WHERE room_id = ? AND status != 'cancelled'
      AND ((check_in <= ? AND check_out > ?) OR (check_in < ? AND check_out >= ?) OR (? <= check_in AND ? > check_in))
    `).get(roomId, checkIn, checkIn, checkOut, checkOut, checkIn, checkOut);

    if (conflict) {
      return res.status(400).json({ success: false, message: 'Room was just booked by someone else. Please choose another date.' });
    }

    // 2. Generate a local ticket reference number
    const localRef = `AG-TICKET-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // 3. Insert Booking into SQLite with a 'pending' status
    const stmt = db.prepare(`
      INSERT INTO bookings (room_id, user_id, guest_name, guest_email, guest_phone, check_in, check_out, special_requests, payment_reference, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(roomId, userId || null, name, email, phone, checkIn, checkOut, specialRequests, localRef, 'pending');

    // 3b. Notify all connected admin dashboards in real-time via SSE
    broadcastBookingNotification({
      id: db.prepare('SELECT last_insert_rowid() as id').get().id,
      guest_name: name,
      guest_email: email,
      room_name: roomLabel,
      check_in: checkIn,
      check_out: checkOut,
      created_at: new Date().toISOString(),
    });
      // 🟢 NEW: Sync to Google Calendar
    if (calendar) {
      try {
        const startDateTime = new Date(`${checkIn}T14:00:00+00:00`).toISOString();
        const endDateTime = new Date(`${checkOut}T11:00:00+00:00`).toISOString();
  
        await calendar.events.insert({
          calendarId: CALENDAR_ID,
          requestBody: {
            summary: `Booking: ${roomLabel} - ${name}`,
            location: 'Airport Grande Luxury Lodge',
            description: `Ticket: ${localRef}\nPhone: ${phone}\nEmail: ${email}\nRequests: ${specialRequests || 'None'}`,
            start: { dateTime: startDateTime, timeZone: 'Africa/Accra' },
            end: { dateTime: endDateTime, timeZone: 'Africa/Accra' },
            colorId: '5',
          },
        });
        console.log(`Calendar event created for ${name}!`);
      } catch (calError) {
        console.error('Google Calendar Sync Failed:', calError.message);
      }
    }
    // 4. Craft and Send the Confirmation Email
    const mailOptions = {
      from: `"Airport Grande Lodge" <${process.env.HOTEL_EMAIL}>`,
      to: email, 
      subject: `Your Booking Ticket - ${roomLabel}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #b45309;">Airport Grande</h2>
          <h3>Booking Confirmation</h3>
          <p>Dear ${name},</p>
          <p>Thank you for choosing us! Your reservation for <strong>${roomLabel}</strong> is locked in.</p>
          
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #666;">YOUR TICKET NUMBER:</p>
            <h1 style="margin: 5px 0; color: #b45309; letter-spacing: 2px;">${localRef}</h1>
          </div>

          <p><strong>Check-in:</strong> ${checkIn}</p>
          <p><strong>Check-out:</strong> ${checkOut}</p>
          <p><em>Please show this ticket number to the front desk upon arrival to process your payment and receive your keys.</em></p>
          <p>Safe travels!</p>
        </div>
      `
    };

    // Send the email in the background
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.error("Failed to send confirmation email:", error);
      else console.log("Ticket sent to:", email);
    });

    // 5. Tell the frontend it was a success!
    res.json({ success: true, message: `Booking reserved! We just emailed your ticket to ${email}.` });

  } catch (error) {
    console.error('Booking error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// API: Get Rooms
app.get('/api/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms').all();
  res.json(rooms);
});

// API: Get All Bookings (Admin)
app.get('/api/admin/bookings', authenticateToken, isAdmin, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, r.name as room_name, r.type as room_type 
    FROM bookings b
    JOIN rooms r ON b.room_id = r.id
    ORDER BY b.created_at DESC
  `).all();
  res.json(bookings);
});

// API: Update Booking Status
app.patch('/api/admin/bookings/:id/status', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// API: Update Room Status
app.patch('/api/admin/rooms/:id/status', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// API: Get User's Bookings
app.get('/api/bookings/my', authenticateToken, (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*, r.name as room_name, r.type as room_type 
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `).all(req.user.id);
    res.json(bookings);
  } catch (error) {
    console.error('Fetch my bookings error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching bookings.' });
  }
});

// API: Create Room (Admin)
app.post('/api/admin/rooms', authenticateToken, isAdmin, (req, res) => {
  const { id, name, type, status } = req.body;
  
  if (!id || !name || !type) {
    return res.status(400).json({ success: false, message: 'Missing required fields (ID, Name, Type).' });
  }

  try {
    const stmt = db.prepare('INSERT INTO rooms (id, name, type, status) VALUES (?, ?, ?, ?)');
    stmt.run(id, name, type, status || 'available');
    res.json({ success: true, message: `Room "${name}" created successfully.` });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ success: false, message: 'A room with this ID already exists.' });
    }
    console.error('Create room error:', error);
    res.status(500).json({ success: false, message: 'Server error creating room.' });
  }
});

// ── SSE: Admin notification stream ──
app.get('/api/admin/notifications/stream', authenticateToken, isAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send a heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);

  const client = { id: Date.now(), res };
  adminClients.push(client);
  console.log(`Admin SSE client connected. Total: ${adminClients.length}`);

  req.on('close', () => {
    clearInterval(heartbeat);
    adminClients = adminClients.filter(c => c.id !== client.id);
    console.log(`Admin SSE client disconnected. Total: ${adminClients.length}`);
  });
});

// Helper: broadcast new booking event to all connected admins
function broadcastBookingNotification(booking) {
  const payload = JSON.stringify(booking);
  adminClients.forEach(client => {
    client.res.write(`event: new_booking\ndata: ${payload}\n\n`);
  });
}

// ── API: Get bookings formatted for calendar ──
app.get('/api/admin/calendar', authenticateToken, isAdmin, (req, res) => {
  try {
    const bookings = db.prepare(`
      SELECT b.id, b.guest_name, b.check_in, b.check_out, b.status,
             r.name as room_name, r.type as room_type
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.status != 'cancelled'
      ORDER BY b.check_in ASC
    `).all();

    // Map to calendar event format
    const events = bookings.map(b => ({
      id: b.id,
      title: `${b.guest_name} · ${b.room_name}`,
      start: b.check_in,
      end: b.check_out,
      status: b.status,
      roomName: b.room_name,
      roomType: b.room_type,
      guestName: b.guest_name,
    }));

    res.json(events);
  } catch (error) {
    console.error('Calendar fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to load calendar data.' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Booking server running at http://localhost:${PORT}`);
});
