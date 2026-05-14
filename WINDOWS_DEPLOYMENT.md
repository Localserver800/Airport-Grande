# Windows Hosting Guide

Since you are using Windows, you can host this application locally or on a Windows VPS.

## 1. Install Node.js
Ensure you have the latest LTS version of Node.js installed from [nodejs.org](https://nodejs.org/).

## 2. Process Management (Keep app running)
To ensure the app stays running in the background and restarts if it crashes, use **PM2**.

Open PowerShell/Command Prompt as **Administrator** and run:
```bash
npm install -g pm2
npm install -g pm2-windows-startup
```

Then, in your project folder:
```bash
pm2 start server.js --name "airport-grande"
pm2-startup install
pm2 save
```

## 3. Environment Variables
Create a `.env` file in the project folder (if you haven't already). PM2 will automatically pick up these variables.

## 4. Making it Public (Access from the Internet)
Since you are on Windows, your computer is likely behind a router firewall. You have two main options to make it public:

### Option A: Cloudflare Tunnel (Recommended & Free)
This is the most secure way to host from a Windows machine without opening router ports.
1. Download `cloudflared` from [Cloudflare](https://github.com/cloudflare/cloudflared/releases).
2. Run: `cloudflared tunnel --url http://localhost:5000`
3. It will give you a public `.trycloudflare.com` URL.

### Option B: Ngrok (Fast for Demos)
1. Install [Ngrok](https://ngrok.com/).
2. Run: `ngrok http 5000`
3. Copy the forwarding URL.

### Option C: Port Forwarding (Permanent)
1. Access your Router Settings.
2. Forward Port **80** (External) to Port **5000** (Internal) of your computer's local IP.
3. Access via your Public IP address.

---
**Note:** Your Windows machine must stay powered on and connected to the internet for the site to remain accessible.
