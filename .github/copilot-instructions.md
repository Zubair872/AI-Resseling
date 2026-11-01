# Project rules for Copilot

- Dev servers (npm run dev, npm run api:dev, npm run api:start) khud foreground mein start mat karo, kyunke wo kabhi khatam nahi hote. Sirf build, test aur lint chalao.
- Agar server chalana zaroori ho to usay background terminal mein chalao aur output ka intezar mat karo.
- Database aur Redis ke liye docker compose ya cloud URLs (.env) use hote hain. Agar available na hon to mujhe batao, khud fake kuch mat banao.
- Koi integration (payment, OAuth, supplier) tab tak "working" mat likho jab tak asli credentials ke saath test na ho.
- Secrets (.env) kabhi commit ya print mat karo.
- Har bade kaam se pehle chhota plan batao, aur ek waqt mein sirf ek feature banao.
- Har step ke baad batao: kya bana, kaise run karna hai, aur kya test hua.
- Mera maqsad code seekhna bhi hai, isliye har nayi file ka ek line mein maqsad likho.
