# Płatności kryptowalutami

Sklep przyjmuje **wyłącznie kryptowaluty**. Każdą sieć włączasz osobno w panelu (Ustawienia → Płatności krypto).
Domyślnie wszystkie są wyłączone. Sieć trafia do kasy dopiero wtedy, gdy przejdzie test konfiguracji i ją włączysz.
Każda zmiana adresu lub klucza wymaga ponownego testu.

## Dwa tryby

### 1. Własna bramka (zalecana)

Środki trafiają **bezpośrednio do Twojego portfela**, bez pośrednika i bez prowizji. Sklep **nie zna kluczy prywatnych**.

| Sieć | Jak rozpoznajemy płatność | Co wkleić w panelu |
|---|---|---|
| BTC, LTC | **unikalny adres dla każdego zamówienia**, wyprowadzany z klucza publicznego portfela | xpub / zpub / ypub (LTC: także Ltub/Mtub) |
| ETH, USDT, USDC (Ethereum, BNB Chain, Polygon), USDT TRC-20 | **jeden adres + unikalna końcówka kwoty** dla każdego zamówienia | adres portfela |
| Bitcoin Testnet4 | jak BTC, testowe monety bez wartości | tpub / vpub |

Źródła danych: publiczne API Esplora (mempool.space, litecoinspace.org), węzły JSON-RPC (publicnode.com),
TronGrid oraz Etherscan (tylko natywne ETH, darmowy klucz API). Każde z nich możesz zastąpić własnym węzłem lub
dostawcą (adres w panelu).

**Zalety:** brak prowizji, brak KYC u pośrednika, pełna kontrola nad środkami, a włamanie na serwer nie daje dostępu do pieniędzy.

**Ograniczenia i ryzyka:**

- *Wspólny adres (ETH/USDT/USDC)*: zamówienie rozpoznajemy po dokładnej kwocie. Jeśli klient wyśle inną kwotę (np. giełda odejmie prowizję), wpływ trafia do „Panel → Płatności → Nieprzypisane wpływy” i przypisujesz go ręcznie. Dla takich zamówień nie da się automatycznie wykryć niedopłaty.
- *Unikalne adresy BTC/LTC*: portfele domyślnie skanują ok. 20 kolejnych pustych adresów. Ustaw w portfelu wyższy „gap limit” (np. 200). Sklep ponownie wykorzystuje czyste adresy z wygasłych zamówień.
- *Publiczne API* mają limity i mogą chwilowo nie działać. Płatności nie przepadają — są sprawdzane ponownie z rosnącym odstępem. Przy większym ruchu użyj własnego węzła lub płatnego dostawcy RPC.
- *Kurs*: kwota jest blokowana na czas płatności (domyślnie 30 min). Płatność po terminie (do 24 h) jest akceptowana i oznaczana w panelu.
- *Zwroty* wykonujesz ręcznie ze swojego portfela i odnotowujesz w panelu.

**Zalecenia bezpieczeństwa:**

- Utwórz **osobny portfel lub osobne konto tylko dla sklepu**, najlepiej na portfelu sprzętowym (Trezor, Ledger).
- Nie używaj adresów z giełdy.
- Fraza odzyskiwania nigdy nie trafia na serwer ani do panelu. Panel odrzuci wklejony klucz prywatny (xprv).
- Po teście **porównaj pokazane adresy** z adresami odbiorczymi w portfelu. Muszą się zgadzać.
- Regularnie przenoś większe kwoty z portfela gorącego na zimny.

### 2. NOWPayments (procesor zewnętrzny)

Adres i kwotę generuje NOWPayments, a środki trafiają na portfel ustawiony w ich panelu. Prowizja wynosi ok. 0,5%.
Zaletą jest automatyczna obsługa nietypowych kwot i wielu walut. Wadami są pośrednik, prowizja i wymogi regulaminu NOWPayments.

Konfiguracja:

1. Załóż konto na nowpayments.io i ustaw w nim swój portfel wypłat.
2. W ich panelu wygeneruj klucz API i **IPN secret**, a jako adres IPN wklej adres pokazany w panelu sklepu.
3. Wpisz klucze w panelu sklepu (sekcja „Klucze API”).
4. Przy wybranej sieci ustaw „NOWPayments” i kliknij „Zapisz i przetestuj”.

Każdy webhook jest weryfikowany podpisem HMAC-SHA512, a status płatności sklep **dodatkowo pobiera z API NOWPayments**.
Sama treść webhooka nie wystarcza, żeby oznaczyć zamówienie jako opłacone.

## Testowanie bez prawdziwych pieniędzy

1. Utwórz portfel testnet w Electrum (`electrum --testnet`) lub Sparrow (Testnet4) i skopiuj vpub.
2. Skonfiguruj „Bitcoin Testnet4” w panelu (na serwerze testowym, nie produkcyjnym).
3. Pobierz testowe monety z faucetu, złóż zamówienie i zapłać — przejdziesz cały proces z e-mailem włącznie.
4. Na produkcji zrób jeden próbny zakup za kilka złotych w wybranej sieci.

## Statusy płatności

| Status | Znaczenie |
|---|---|
| Oczekuje | nic nie wpłynęło |
| Potwierdzanie | wpłynęła pełna kwota, czekamy na potwierdzenia |
| Niedopłacone | wpłynęło za mało; klient może dopłacić przed terminem, potem decyzja należy do obsługi |
| Opłacone | wymagane potwierdzenia osiągnięte → automatyczna realizacja (ewentualnie z oznaczeniem „po terminie” / „nadpłata”) |
| Wygasłe | brak płatności do końca okresu obserwacji |
| Zwrócone | zwrot odnotowany przez administratora |
