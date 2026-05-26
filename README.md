# Manufacturing Planning & Production Control System

A complete manufacturing ERP web application built from an Excel planning workbook.

## Features
- 📋 Order Entry — full CRUD for production jobs
- 🗂 Kanban Board — visual job flow by status  
- 📅 Gantt Chart — timeline with color-coded bars
- 🏭 Factory Board — capacity loading per factory
- 🔩 Procurement — material tracking and supplier management
- 🚨 Alerts — deadline notifications with live bell indicator
- 📥 PDF Import — local AI extraction via PDF.js (no API needed)
- 📧 Gmail Reader — connect Gmail with email + app password
- 🤖 AI Assistant — Claude AI inside every job panel
- 🔒 Access Control — roles, permissions, user management
- 📱 Mobile Responsive — works on all screen sizes

## Live App
Open `index.html` directly in any browser — no server needed for the main app.

## Gmail Email Reader (optional)
To enable Gmail inbox scanning:
```bash
npm install
node server.js
```
Then open http://localhost:3000

## Login
- Email: `manager@factory.com`
- Password: `admin123`

Other accounts: `rahul@factory.com`, `priya@factory.com`, `amir@factory.com` (all password: `admin123`)
