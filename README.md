# Orbitly

Markaz se product uthao, price + apna profit likho, Buffer se post karo, customer se deal karo, Markaz ko order do.

## Local run

```
npm ci
npm run api:dev
npm run dev
```

Doosray terminal mein `npm run dev`. App: http://localhost:5173 (API: http://localhost:4000).
Database/Redis/.env zaroori nahi.

## Flow

1. Integrations > API keys: Buffer key save karo, Connect dabao, phir Sync.
2. Markaz Studio: Markaz link paste karo, Preview, catalog mein add (profit price mein add hota hai).
3. Post now ya time chuno. Post Buffer ke zariye jati hai.
4. Customers: chat/deal. Orders: summary Markaz ko bhejo.

Keys encrypted save hoti hain; sirf aakhri 4 characters dikhte hain.
