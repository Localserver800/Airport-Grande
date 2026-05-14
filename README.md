# Airport Grande Luxury Lodge & Apartments - Booking System

A full-stack booking and management system for a luxury serviced apartment complex in Accra, Ghana.

## Features

- **Secure Booking Engine:** Server-side pricing and availability checks.
- **Integrated Payments:** Real-time payment processing via Paystack Inline.
- **Authentication:** JWT-based secure login for both Guests (Clients) and Staff (Admins).
- **Dashboards:**
  - **Client Dashboard:** Manage personal bookings and profile.
  - **Admin Dashboard:** Full control over room inventory and reservation statuses.
- **Dynamic Pricing:** Live USD-to-GHS exchange rate integration.
- **Responsive Design:** Modern, mobile-first UI built with Tailwind CSS.

## Tech Stack

- **Frontend:** HTML5, Tailwind CSS, Lucide Icons, Vanilla JavaScript.
- **Backend:** Node.js, Express.js.
- **Database:** SQLite (via `better-sqlite3`).
- **Auth:** Passport.js, JWT, Bcrypt.js.
- **Payments:** Paystack SDK.

## Setup Instructions

### 1. Prerequisites
- Node.js (v18+ recommended)
- npm

### 2. Installation
```bash
npm install
```

### 3. Configuration
Create a `.env` file in the root directory and add the following:
```env
PORT=5000
JWT_SECRET=your_super_secret_key
EXCHANGE_API_KEY=your_exchangerate_api_key (optional, for live rates)
PAYSTACK_SECRET_KEY=your_paystack_secret_key
```

### 4. Database Initialization
The database will automatically seed with 8 apartments and 6 standard rooms upon the first launch if the `airport_grande.db` file does not exist.

### 5. Running the Application
```bash
node server.js
```
The application will be available at `http://localhost:5000`.

## Admin Credentials
By default, you can create an admin user directly in the database or via a signup flow (if modified). To access the Admin Dashboard, ensure your user role is set to `admin`.

---
© 2026 Airport Grande Luxury Lodge & Apartments.
