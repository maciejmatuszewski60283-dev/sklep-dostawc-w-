# Architektura i wybór technologii

## Dlaczego taki zestaw

| Element | Wybór | Uzasadnienie |
|---|---|---|
| Serwer | Node.js 22 + Express | dojrzały, szybki, jedna aplikacja zamiast wielu usług — łatwa w utrzymaniu |
| Baza danych | SQLite (WAL) | jeden plik, zero administracji, kopia zapasowa jednym poleceniem; bez problemu obsłuży tysiące zamówień dziennie. Przy dużej skali można przejść na PostgreSQL |
| Widoki | renderowanie po stronie serwera (EJS) + mały skrypt JS | szybkie ładowanie na słabych telefonach, działa bez JavaScriptu, łatwa ochrona CSRF i ścisła polityka CSP |
| Zdjęcia | sharp | weryfikacja, że plik jest obrazem, zmiana rozmiaru, WebP, usuwanie metadanych |
| E-mail | nodemailer (SMTP) | działa z każdym dostawcą poczty |
| Płatności | własny moduł + opcjonalnie NOWPayments | patrz [PLATNOSCI.md](PLATNOSCI.md) |
| Hosting | 1 serwer VPS + Docker + Cloudflare Tunnel | niski koszt (od ok. 20–40 zł/mies.), ukryty adres IP, darmowa ochrona DDoS i HTTPS |

## Struktura projektu

```
src/
  server.js              uruchomienie aplikacji, workerów i zadań okresowych
  app.js                 konfiguracja Express (nagłówki, limity, sesje, CSRF, trasy)
  config.js              zmienne środowiskowe
  db/                    połączenie i migracje bazy (schemat w migrations/001_init.sql)
  lib/                   szyfrowanie, TOTP, ustawienia, logi zdarzeń, walidacja, obrazy, markdown
  middleware/            sesje, CSRF, nagłówki bezpieczeństwa, limity, uprawnienia panelu
  services/
    catalog, cart, discounts, orders     logika sklepu
    payments/                            bramka płatności: sieci, adresy, monitoring, NOWPayments
    delivery.js                          automatyczna realizacja zamówień i magazyn
    email.js, jobs.js                    e-maile i trwała kolejka zadań z ponawianiem
  routes/                sklep, kasa, zamówienia, webhooki, panel administratora
views/                   szablony stron, panelu i e-maili
public/                  CSS, JS, ikony
scripts/                 konto admina, kopie zapasowe, sekrety, dane demo
deploy/                  Dockerfile, docker-compose (z Cloudflare Tunnel), systemd, cron
test/                    testy automatyczne
```

## Przepływ zamówienia

1. Klient wybiera produkty, podaje e-mail, wybiera sieć płatności i akceptuje zgody.
2. Serwer liczy kwotę w krypto po bieżącym kursie, przydziela unikalny adres (BTC/LTC) lub unikalną kwotę (sieci EVM/Tron) i rezerwuje towar na czas płatności.
3. Worker płatności co ~20 s sprawdza blockchain (albo status w NOWPayments + webhook).
4. Po wymaganej liczbie potwierdzeń płatność zostaje oznaczona jako opłacona — **jedynie na podstawie danych z sieci lub podpisanego webhooka zweryfikowanego przez API**.
5. Kolejka zadań realizuje zamówienie w transakcji bazy danych (przypisanie kluczy), a potem wysyła e-mail z linkiem do odbioru. Unikalne klucze zadań gwarantują, że nic nie zostanie wysłane dwa razy.
6. Klient otwiera link, a klucz pojawia się dopiero po kliknięciu „Odbierz produkty”. Strona nie jest buforowana, a dostęp wygasa po ustawionym czasie.

## Środowiska

`NODE_ENV=development` (lokalnie), `test` (testy automatyczne — osobna baza tymczasowa i symulowane API),
`production` (wymaga kompletnych sekretów i adresu https). Każde środowisko ma osobny plik `.env` i osobny katalog danych.
