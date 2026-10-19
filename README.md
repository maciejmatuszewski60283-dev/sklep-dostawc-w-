# najtańsze itemki — sklep z produktami cyfrowymi (płatności tylko w krypto)

Kompletny sklep internetowy: katalog z wyszukiwarką i filtrami, koszyk, kasa, **własna bramka płatności
kryptowalutowych** (BTC, LTC, ETH, USDT, USDC), automatyczna dostawa kluczy/plików po potwierdzeniu
płatności, e-maile do klientów oraz panel administratora z 2FA. Całym sklepem zarządzasz z panelu,
bez edytowania kodu.

## Co jest w środku

| Obszar | Co działa |
|---|---|
| Sklep | strona główna, katalog, kategorie i podkategorie, platformy, wyszukiwarka, filtry ceny i dostępności, sortowanie, strona produktu z galerią i wariantami, koszyk, kody rabatowe, kasa, strona statusu zamówienia, strony informacyjne, wersja mobilna |
| Płatności | własna bramka (środki prosto do Twojego portfela, bez prowizji) lub NOWPayments; unikalny adres/kwota dla każdego zamówienia, kod QR, termin płatności, monitoring potwierdzeń, niedopłaty, nadpłaty, płatności po terminie, ręczne przypisanie wpływu, zwroty |
| Dostawa | automatyczne przypisanie klucza z magazynu, plik do pobrania lub realizacja ręczna; brak towaru = zamówienie czeka i realizuje się samo po uzupełnieniu magazynu; ochrona przed podwójną wysyłką |
| E-mail | potwierdzenie zamówienia z instrukcją płatności, e-mail z linkiem do odbioru, powiadomienia dla Ciebie; kolejka z ponawianiem i historią |
| Panel | pulpit ze statystykami, produkty ze zdjęciami (upload z przeglądarki), magazyn kluczy, zamówienia z wyszukiwarką, płatności, dostawy, rabaty, strony/regulaminy, ustawienia, użytkownicy z rolami, dziennik zdarzeń |
| Bezpieczeństwo | 2FA obowiązkowe, blokada po nieudanych logowaniach, CSRF, CSP, limity żądań, szyfrowanie kluczy i sekretów w bazie, weryfikacja podpisów webhooków, walidacja zdjęć — szczegóły w [docs/BEZPIECZENSTWO.md](docs/BEZPIECZENSTWO.md) |

## Szybki start (na swoim komputerze)

Wymagany **Node.js 22** lub nowszy.

```bash
npm install
cp .env.example .env
npm run secrets:generate        # wklej wynik do pliku .env
npm run admin:create            # utwórz konto właściciela
npm start                       # sklep: http://localhost:3000
```

Panel znajdziesz pod adresem z `ADMIN_PATH` (domyślnie `/admin`). Przy pierwszym logowaniu
skonfigurujesz aplikację 2FA (np. Aegis, 2FAS, Google Authenticator).

Chcesz zobaczyć sklep z przykładowymi produktami? `npm run seed:demo` (tylko lokalnie — w produkcji się nie uruchomi).

## Pierwsze kroki w panelu

1. **Płatności krypto** — wklej xpub/zpub portfela (BTC/LTC) albo adres (USDT/USDC/ETH), kliknij „Zapisz i przetestuj”, porównaj adresy z portfelem, kliknij „Włącz”.
2. **E-mail** — wpisz dane SMTP i wyślij test.
3. **Ogólne** — e-mail obsługi klienta, teksty strony głównej.
4. **Strony i regulaminy** — uzupełnij pola `[DO UZUPEŁNIENIA]`.
5. **Produkty → Dodaj produkt**, potem **Magazyn kluczy** — wklej klucze (jeden w linii).
6. Zrób próbny zakup (np. w sieci Bitcoin Testnet4 lub za kilka złotych w USDT TRC-20).

## Dokumentacja

- [docs/WDROZENIE.md](docs/WDROZENIE.md) — serwer, domena, Cloudflare, HTTPS, aktualizacje, kopie zapasowe
- [docs/PLATNOSCI.md](docs/PLATNOSCI.md) — jak działa bramka, konfiguracja portfeli, ryzyka
- [docs/BEZPIECZENSTWO.md](docs/BEZPIECZENSTWO.md) — zabezpieczenia, DDoS, prywatność, checklista przed startem
- [docs/PRAWO.md](docs/PRAWO.md) — co musisz uzupełnić i sprawdzić pod kątem prawa
- [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md) — technologia i struktura projektu

## Polecenia

| Polecenie | Do czego |
|---|---|
| `npm start` | uruchomienie sklepu |
| `npm test` | testy automatyczne (zakup, płatności, dostawa, webhooki, uprawnienia, bezpieczeństwo) |
| `npm run admin:create` | nowe konto właściciela |
| `npm run admin:reset-2fa -- <login>` | awaryjny reset 2FA (np. zgubiony telefon) |
| `npm run backup` | kopia zapasowa bazy, zdjęć i plików |
| `npm run restore -- <plik>` | odtworzenie z kopii |
| `npm run secrets:generate` | wygenerowanie sekretów do `.env` |
