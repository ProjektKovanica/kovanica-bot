-- FIX: Ručne isplate koje nisu zabilježene

-- 1. Korisnik 7617863185 (-201.794,80 KVNC)
UPDATE users 
SET click_balance = click_balance - 201794.80 
WHERE telegram_id = '7617863185';

-- 2. Korisnik 6838985168 (-52.279,19 KVNC)
UPDATE users 
SET click_balance = click_balance - 52279.19 
WHERE telegram_id = '6838985168';

-- 3. Korisnik 8619748852 (-11.723,00 KVNC)
UPDATE users 
SET click_balance = click_balance - 11723.00 
WHERE telegram_id = '8619748852';

-- 4. Korisnik s adresom ...VCTi - NIJE PRONAĐEN!
--    Treba ga pronaći po Telegram ID-u ako znaš tko je.
--    Za sada preskačemo.

-- Provjera nakon ažuriranja
SELECT telegram_id, click_balance, ton_wallet 
FROM users 
WHERE telegram_id IN ('7617863185', '6838985168', '8619748852');
