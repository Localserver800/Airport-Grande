# DigitalOcean VPS Deployment Guide

This guide will help you host the **Airport Grande Booking System** on a DigitalOcean Droplet (Ubuntu 22.04+).

## 1. Server Setup
Login to your VPS:
```bash
ssh root@your_server_ip
```

Update system and install Node.js:
```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
```

Install PM2 (Process Manager):
```bash
sudo npm install -g pm2
```

## 2. Deploy Code
Clone your repository (or upload files):
```bash
git clone <your-repo-url>
cd <project-folder>
npm install --production
```

## 3. Environment Variables
Create the `.env` file on the server:
```bash
nano .env
```
Paste your configuration (ensure `HOTEL_PASSWORD`, `PAYSTACK_SECRET_KEY`, etc. are correct).

## 4. Launch the App
Use PM2 to start the server:
```bash
npm run prod
pm2 save
pm2 startup
```

## 5. Reverse Proxy (Nginx)
Install Nginx:
```bash
sudo apt install -y nginx
```

Configure Nginx:
```bash
sudo nano /etc/nginx/sites-available/default
```

Replace the content with:
```nginx
server {
    listen 80;
    server_name your_domain_or_ip;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Test and restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

## 6. Security (Optional but Recommended)
Setup a firewall:
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---
**Note:** Since you are using SQLite, the database (`airport_grande.db`) will live inside the project folder on your VPS. It is automatically persistent.
