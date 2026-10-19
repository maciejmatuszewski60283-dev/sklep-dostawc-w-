# Bezpieczeństwo, ochrona przed atakami i prywatność

## Zabezpieczenia aplikacji (OWASP Top 10)

| Zagrożenie | Zabezpieczenie |
|---|---|
| Wstrzyknięcie SQL | wyłącznie zapytania parametryzowane (better-sqlite3), filtry LIKE z escapowaniem |
| XSS | automatyczne escapowanie w szablonach, opisy w Markdown czyszczone (sanitize-html), ścisła polityka **CSP** (bez skryptów inline i zewnętrznych) |
| CSRF | token w każdym formularzu powiązany podpisem HMAC z ciasteczkiem + kontrola nagłówka Origin + ciasteczka SameSite |
| Przejęcie konta admina | hasło min. 12 znaków (scrypt), **obowiązkowe 2FA (TOTP)** z kodami odzyskiwania, blokada po 5 nieudanych próbach (konto) i 20 (adres IP), wylogowanie po 30 min bezczynności i 12 h łącznie, nowa sesja po zalogowaniu, unieważnienie sesji po zmianie hasła |
| Kontrola dostępu | role (właściciel / menedżer / obsługa) sprawdzane po stronie serwera; dostęp do zamówienia tylko przez losowy token z e-maila (w bazie tylko jego skrót) |
| Dane wrażliwe | klucze produktów, hasło SMTP i klucze API szyfrowane AES-256-GCM; klucz szyfrujący tylko w `.env`; klucze nigdy nie trafiają do e-maili, adresów URL ani logów; strony z kluczami mają `Cache-Control: no-store` |
| Pliki | zdjęcia weryfikowane i przetwarzane przez sharp (plik udający obraz jest odrzucany), metadane EXIF/GPS usuwane, losowe nazwy; pliki do dostawy poza katalogiem publicznym, pobierane linkiem ważnym 15 minut |
| Webhooki | podpis HMAC-SHA512 (porównanie w stałym czasie), status pobierany z API procesora, deduplikacja zdarzeń |
| Fałszywe płatności | zamówienie oznaczane jako opłacone wyłącznie na podstawie blockchaina (z wymaganymi potwierdzeniami i weryfikacją transakcji) lub zweryfikowanego API procesora |
| Podwójna realizacja | transakcje bazy danych, unikalne klucze zadań, idempotentne zmiany statusów |
| Nadużycia i boty | limity żądań (ogólny, wyszukiwarka, koszyk, kasa, logowanie, webhooki, odpytywanie statusu), pole-pułapka w kasie, limit nieopłaconych zamówień na e-mail |
| Nagłówki | Helmet: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy; brak nagłówka X-Powered-By |
| Wyciek informacji | ogólne komunikaty błędów dla użytkowników; ścieżka panelu nie występuje na stronach publicznych ani w robots.txt; panel ma `noindex` |
| Zależności | `npm audit` przed każdą aktualizacją; obraz Docker z minimalnym systemem, bez uprawnień root, z systemem plików tylko do odczytu |
| Logowanie zdarzeń | dziennik w panelu: logowania, blokady, CSRF, webhooki, płatności, działania administratorów (bez danych wrażliwych); retencja 90 dni |

## Ochrona przed DDoS i atakami konkurencji

**Żadne rozwiązanie nie daje 100% ochrony przed DDoS.** Poniższy zestaw jest rozsądny przy małym budżecie.

| Warstwa | Rozwiązanie | Koszt |
|---|---|---|
| Sieć (L3/L4) | Cloudflare — ochrona przed atakami wolumetrycznymi | darmowe (bez limitu) |
| Ukrycie IP serwera | Cloudflare Tunnel — serwer nie ma otwartych portów HTTP, ruch idzie tylko przez Cloudflare | darmowe |
| Aplikacja (L7) | Cloudflare Bot Fight Mode, 1 reguła rate limiting, reguły WAF | darmowe |
| Aplikacja (L7) — więcej | zarządzane reguły WAF (OWASP), więcej reguł limitów, zaawansowana analiza botów | plan Pro ok. 20–25 USD/mies. |
| Panel administratora | Cloudflare Access (logowanie e-mailem przed panelem) + 2FA w sklepie + nieoczywisty `ADMIN_PATH` | darmowe |
| Serwer | limity żądań w aplikacji, zapora ufw (tylko SSH), limit pamięci kontenera | darmowe |
| Nagły wzrost ruchu | strony katalogu są lekkie; pliki statyczne buforowane przez Cloudflare; w razie ataku włącz tryb „Under Attack” w Cloudflare | darmowe |
| Dostępność | monitoring `/healthz` z alertami, automatyczny restart kontenera, kopie zapasowe, procedura odtwarzania | darmowe |

**Pamiętaj:** jeśli adres IP serwera kiedyś „wyciekł” (np. dawny rekord DNS typu A), po przejściu na tunel zmień serwer lub jego IP.
Nie wysyłaj e-maili bezpośrednio z serwera sklepu — nagłówki wiadomości ujawniają IP. Używaj zewnętrznego SMTP.

## Prywatność właściciela

- **WHOIS**: włącz ochronę prywatności u rejestratora. Nie podawaj fałszywych danych — to narusza regulaminy rejestratorów i może skończyć się utratą domeny.
- **Ukryte IP** dzięki Cloudflare Tunnel (patrz wyżej).
- **Brak danych osobowych w kodzie**: w repozytorium i na stronie nie ma Twoich danych. Pokazywane są tylko dane wpisane w panelu. Zdjęcia są pozbawiane metadanych (w tym lokalizacji GPS).
- **Osobna tożsamość służbowa**: osobna skrzynka (np. `pomoc@twojadomena.pl`) i osobne konta (Cloudflare, hosting, dostawca poczty) z silnymi hasłami i 2FA.
- **Sekrety** tylko w `.env` na serwerze (uprawnienia `chmod 600 .env`), nigdy w repozytorium. Repozytorium ustaw jako **prywatne**.
- **Minimalizacja danych klientów**: zbieramy tylko e-mail i dane zamówienia; adres IP przy zamówieniu zapisujemy jako skrót (pseudonimizacja).
- **Kopie zapasowe i logi**: kopie mają uprawnienia `600`; przechowuj je zaszyfrowane, osobno od `ENCRYPTION_KEY`.

> Anonimowość techniczna nie oznacza anonimowości prawnej. Dostawcy usług (hosting, Cloudflare, rejestrator, giełdy)
> znają Twoje dane, a przepisy wymagają ujawnienia danych sprzedawcy klientom i rozliczenia podatków. Patrz [PRAWO.md](PRAWO.md).

## Checklista przed uruchomieniem

**Konfiguracja**
- [ ] `NODE_ENV=production`, `PUBLIC_URL` z https, nowe losowe `SESSION_SECRET` i `ENCRYPTION_KEY` (kopia klucza w menedżerze haseł)
- [ ] `ADMIN_PATH` zmieniony na trudny do odgadnięcia; Cloudflare Access przed panelem
- [ ] 2FA skonfigurowane, kody odzyskiwania zapisane offline
- [ ] serwer: zapora (tylko SSH), logowanie kluczem SSH, automatyczne aktualizacje
- [ ] Cloudflare: Full (strict), Always HTTPS, Bot Fight Mode, reguła rate limiting
- [ ] e-mail: SPF/DKIM/DMARC, test wysyłki z panelu, wiadomość nie trafia do SPAMU
- [ ] kopie zapasowe codziennie + kopia poza serwerem; **przetestowane odtworzenie**
- [ ] monitoring `/healthz` z alertem
- [ ] dane demonstracyjne usunięte (jeśli były)

**Testy ścieżek zakupowych (ręczne, na produkcji)**
- [ ] zakup za małą kwotę w każdej włączonej sieci → płatność wykryta → e-mail → odbiór klucza
- [ ] porównanie adresów z portfelem (BTC/LTC: pierwsze 3 adresy)
- [ ] zamówienie bez płatności wygasa po czasie
- [ ] produkt bez kluczy w magazynie → zamówienie „czeka na towar” → po dodaniu klucza realizuje się samo
- [ ] „Znajdź zamówienie” wysyła nowy link
- [ ] wygląd na telefonie (Android/iOS) i komputerze
- [ ] nieudane logowania do panelu → blokada, wpis w dzienniku zdarzeń

**Testy automatyczne** — `npm test` (25 testów): ścieżka zakupu z potwierdzeniami blockchain, idempotentność,
brak towaru, rezerwacje, niedopłata i nadpłata, wygasanie, błędy SMTP i ponowienia, webhook NOWPayments
(podpis, weryfikacja przez API, duplikaty), sieć EVM z unikalnymi kwotami i ręcznym przypisaniem, awaria API kursów,
walidacja kasy i pułapka na boty, uprawnienia ról, blokada logowania, CSRF, upload złośliwego pliku, nagłówki,
wektory testowe BIP32/BIP84/BIP49, TOTP (RFC 6238), szyfrowanie, XSS w opisach.

Testy obciążeniowe i penetracyjne wykonuj **wyłącznie na własnym serwerze testowym**, nigdy na cudzej infrastrukturze.
Przykład podstawowego testu wydajności: `npx autocannon -c 50 -d 20 http://localhost:3000/produkty`.
