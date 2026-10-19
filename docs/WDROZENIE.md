# Wdrożenie na własnym serwerze i domenie

Nie potrzebujesz jeszcze domeny, żeby przetestować sklep. Kolejność:
**serwer → uruchomienie → test na tymczasowym adresie → domena → Cloudflare → produkcja**.

## 1. Serwer (VPS)

Wystarczy najmniejszy VPS: 1–2 vCPU, 1–2 GB RAM, Ubuntu 24.04 LTS (np. Hetzner, OVH, Contabo, Mikr.us).
Koszt to ok. 20–40 zł miesięcznie.

Na serwerze:

```bash
# aktualizacje i zapora: otwarty tylko SSH
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 git ufw unattended-upgrades
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw enable
sudo dpkg-reconfigure -plow unattended-upgrades   # automatyczne poprawki bezpieczeństwa
```

Logowanie SSH ustaw wyłącznie na klucz: w `/etc/ssh/sshd_config` ustaw `PasswordAuthentication no`, potem `sudo systemctl restart ssh`.

## 2. Uruchomienie

```bash
git clone <adres-twojego-repozytorium> /opt/najtansze-itemki
cd /opt/najtansze-itemki
cp .env.example .env
docker run --rm -v "$PWD":/app -w /app node:22-bookworm-slim node scripts/generate-secrets.js
nano .env      # wklej sekrety, ustaw NODE_ENV=production, PUBLIC_URL=https://..., TRUST_PROXY=1
mkdir -p data && sudo chown 1000:1000 data
docker compose -f deploy/docker-compose.yml up -d --build app
docker compose -f deploy/docker-compose.yml exec app node scripts/create-admin.js
```

> **Zachowaj kopię `ENCRYPTION_KEY`** w menedżerze haseł. Bez niego nie odczytasz zaszyfrowanych kluczy produktów ani haseł SMTP z kopii zapasowej.

### Tymczasowy adres do testów (bez domeny)

Na serwerze uruchom: `docker run --rm --network host cloudflare/cloudflared:2025.9.1 tunnel --url http://localhost:3000`.
Dostaniesz adres `https://<losowe-słowa>.trycloudflare.com`. Ustaw go chwilowo jako `PUBLIC_URL` w `.env` i zrestartuj aplikację.
Taki adres zmienia się przy każdym uruchomieniu i nadaje się tylko do testów.

## 3. Domena i Cloudflare

1. Kup domenę u dowolnego rejestratora i **włącz ochronę prywatności WHOIS** (u większości rejestratorów jest darmowa; dla domen .pl dane osób fizycznych i tak nie są publikowane).
2. Załóż darmowe konto Cloudflare, dodaj domenę i zmień serwery DNS u rejestratora na te podane przez Cloudflare.
3. W Cloudflare przejdź do **Zero Trust → Networks → Tunnels → Create tunnel** (typ Cloudflared) i skopiuj token.
4. W tunelu dodaj **Public Hostname**: `twojadomena.pl` → `HTTP` → `app:3000`.
5. W `.env` ustaw:
   ```
   PUBLIC_URL=https://twojadomena.pl
   CLOUDFLARE_TUNNEL_TOKEN=<token>
   TRUST_PROXY=1
   ```
6. Uruchom wszystko: `docker compose -f deploy/docker-compose.yml up -d --build`

HTTPS zapewnia Cloudflare automatycznie. Serwer nie ma otwartego portu 80/443, więc jego adres IP nie jest powiązany z domeną w DNS.

### Zalecane ustawienia Cloudflare (plan darmowy)

- SSL/TLS → **Full (strict)**, Always Use HTTPS, minimalna wersja TLS 1.2
- Security → **Bot Fight Mode**: włączony
- Security → WAF → **Rate limiting rules** (w planie darmowym 1 reguła): np. ścieżki `/kasa` i ścieżka panelu, 20 żądań / 10 s → blokada
- Zero Trust → **Access → Applications**: dodaj aplikację dla `twojadomena.pl/<ADMIN_PATH>` z logowaniem kodem e-mail tylko dla Twojego adresu. Panel będzie wtedy niewidoczny dla świata (darmowe do 50 użytkowników)
- Caching → domyślne (sklep sam oznacza, czego nie wolno buforować)

### E-mail w domenie

Dodaj w DNS rekordy SPF, DKIM i DMARC podane przez dostawcę poczty (Brevo, Mailgun, Postmark, Amazon SES…).
Bez nich wiadomości trafią do SPAMU. Do kontaktu z klientami używaj osobnej skrzynki służbowej, np. `pomoc@twojadomena.pl`.

## 4. Aktualizacja sklepu

```bash
cd /opt/najtansze-itemki
docker compose -f deploy/docker-compose.yml exec app node scripts/backup.js /app/data/backups   # kopia przed aktualizacją
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

Migracje bazy wykonują się automatycznie przy starcie. Zależności sprawdzaj co miesiąc poleceniem `npm audit`.

## 5. Kopie zapasowe

- Ręcznie: `docker compose -f deploy/docker-compose.yml exec app node scripts/backup.js /app/data/backups`
- Automatycznie: dodaj powyższe polecenie do `crontab -e` (np. codziennie o 3:17). Bez Dockera użyj `deploy/backup.cron`.
- Kopie trzymaj **także poza serwerem** (np. `rclone` do chmury, zaszyfrowane). Trzymaj je osobno od `ENCRYPTION_KEY`.
- Skrypt zostawia 14 ostatnich kopii.

### Odtwarzanie (procedura awaryjna)

1. Zatrzymaj sklep: `docker compose -f deploy/docker-compose.yml stop app`
2. Skopiuj plik kopii do `data/backups/` i uruchom:
   `docker compose -f deploy/docker-compose.yml run --rm app node scripts/restore.js /app/data/backups/<plik>.tar.gz`
3. Upewnij się, że `.env` ma ten sam `ENCRYPTION_KEY` co w chwili tworzenia kopii.
4. Uruchom sklep: `docker compose -f deploy/docker-compose.yml up -d`

Awaria całego serwera: postaw nowy VPS (kroki 1–2), odtwórz kopię, uruchom tunel z tym samym tokenem.
DNS nie wymaga zmian, bo tunel wskazuje na nowy serwer automatycznie.

## 6. Monitoring

- Darmowe monitorowanie dostępności (np. UptimeRobot, Better Stack) adresu `https://twojadomena.pl/healthz` z alertem e-mail/SMS.
- Powiadomienia sklepu (Panel → E-mail): nowe opłacone zamówienia, brak towaru, błędy wysyłki.
- Dziennik zdarzeń w panelu: nieudane logowania, odrzucone webhooki, błędy płatności.
- Logi aplikacji: `docker compose -f deploy/docker-compose.yml logs -f app`

## Zmienne środowiskowe

| Zmienna | Opis |
|---|---|
| `NODE_ENV` | `production` na serwerze |
| `PORT` | port aplikacji (domyślnie 3000) |
| `PUBLIC_URL` | publiczny adres sklepu, w produkcji `https://…` |
| `ADMIN_PATH` | ścieżka panelu — ustaw trudną do odgadnięcia |
| `SESSION_SECRET` | sekret sesji (min. 32 znaki) |
| `ENCRYPTION_KEY` | 64 znaki hex — szyfrowanie danych wrażliwych |
| `DATA_DIR` | katalog na bazę, zdjęcia i pliki |
| `TRUST_PROXY` | liczba serwerów proxy przed aplikacją (Cloudflare Tunnel = 1) |
| `MAX_DELIVERY_FILE_MB` | limit pliku do dostawy |
| `CLOUDFLARE_TUNNEL_TOKEN` | token tunelu (używany przez docker-compose) |
