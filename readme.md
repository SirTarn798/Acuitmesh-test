# XO GAME (Acuitmest inturn test)
## About
นี่เป็นโปรแกรม Backend ที่พัฒนาเพื่อสร้างเกม XO ให้ผู้เล่นสามารถเล่นด้วยกันได้
โดยมีระบบการเช็คยอดผู้เล่น การเชิญ เกมเพลย์ เล่นกับบอท และการเรียกดูประวัติการแข่งขันได้ด้วย
พัฒนาด้วย ExpressJS, Socket.io

## Features
### 1. การยืนยันตัวตน
สามารถทำการสมัครได้ด้วยการส่ง POST request ไปที่ /register โดยมี Body เป็น Username และ Password
หลังจากนั้นให้ส่ง POST request ไปที่ /login โดยที่ต้องมี Body เป็น Username และ Password หลังจากนั้น
จะได้รับ response เป็น token มา ให้นำไปใส่ใน Header authorization ในขณะที่ใช้ Socket.io
### 2. การเชิญผู้เล่นคนอื่น
สามารถทำได้ด้วยการใช้ Socket ส่ง message ไปที่ช่อง invite โดย message อยู่ในรูปแบบ json โดยมี username
สามารถดูรายชื่อผู้เล่นได้จากช่อง getPlayers และสามารถดูคำเชิญที่ส่งมาหาเราได้ด้วย getInvites โดยมีข้อจำกัดคือ
หากมีคำเชิญค้างไว้อยู่ที่ผู้เล่นคนนั้น จะไม่สามารถเชิญเพิ่มได้
### 3. การเล่น
เกมส์จะเริ่มเมื่อผู้เล่นรับคำเชิญด้วยการส่ง message ไปที่ช่อง acceptInvite โดยมี username แล้วเล่นโดยส่ง message ที่มี
tile เป็นค่าจำนวนเต็ม 1 - 9 ไปที่ play หากเกมส์จบ ระบบจะแจ้งเตือนผู้เล่น และหากผู้เล่นออกจากระบบก่อนเกมส์จบ ผู้เล่นจะแพ้ทันที
หากมีเหตุการณ์นอกเหนือจากนี้ เช่น รับคำเชิญโดยที่มีเกมดำเนินอยู่ ส่ง message ไปที่ play โดยที่ไม่ได้อยู่ในเกม ระบบจะทำการแจ้งเตือนผู้เล่น
### 4. การเล่นกับบอท
เริ่มด้วยการถ้าผู้เล่นไม่มีเกมที่กำลังดำเนินการอยู่ ให้ส่ง Message ไปที่ playWithBot หลังจากนั้นบอทจะทำการเริ่มเล่นก่อนโดยเป็น X จากนั้น
สามารถเล่นได้โดยปกติโดยการส่ง Message ไปที่่ play เหมือนการเล่นปกติ
### 5. การดูประวัติ
ส่ง message ไปที่ getHistory เพื่อดูประวัติการแข่งขัน

## How to use
### 1. โคลน repository มาโดยใช้คำสั่ง
```
git clone https://github.com/SirTarn798/Acuitmesh-test.git
```
### 2. จัดการติดตั้ง node package โดยเข้าไปที่ repository ที่โคลนมาแล้วใช้คำสั่ง 
```
npm i
```
### 3. จัดการตั้งค่า Database ที่ตนใช้ โดยสร้าง Table ให้ได้ตาม ER หรือใช้ SQL Query ที่ให้ไว้
### 4. เชื่อมต่อกับ Database
### 5. สร้าง .env ไฟล์โดยมี
```
SECRET_KEY = 
DB_PASSWORD =
```
แล้วกำหนดค่า โดย SECRET_KEY คือ key ที่ใช้ sign jwt และ DB_PASSWORD คือรหัสผ่านเข้าฐานข้อมูล
### 6. รัน server.js โดยใช้คำสั่ง
```
node .\server.js
```
### 7. สร้าง ACCOUNT โดยใช้ Username เป็น XO-BOT ก่อนเริ่มใช้งาน
### 8. เริ่มใช้งานได้โดยใช้ Postman collection ตามที่ให้ไว้เป็น Template หรือลองเขียน Request เอง
### *** โปรดตรวจสอบให้แน่ใจว่า Request แต่ละอันกำลังฟัง Event login, reply, error และ notification เพื่อการแสดงผลที่ถูกต้องและต้องมี Header authorization ด้วย





