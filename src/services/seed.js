'use strict';
// Dane startowe: dokumenty prawne (szablony do uzupełnienia), podstawowe kategorie i platformy.
// Wykonywane tylko raz, przy pierwszym uruchomieniu — później wszystko edytujesz w panelu.
const db = require('../db');
const settings = require('../lib/settings');

const TODO = '[DO UZUPEŁNIENIA]';

const PAGES = [
  {
    slug: 'regulamin', title: 'Regulamin sklepu', sort: 1, body: `> **Uwaga dla właściciela sklepu:** to szablon. Uzupełnij wszystkie pola oznaczone ${TODO} i przed publikacją skonsultuj dokument z prawnikiem. Usuń tę notatkę po uzupełnieniu.

## §1. Postanowienia ogólne

1. Sklep internetowy „najtańsze itemki”, dostępny pod adresem ${TODO}: adres strony, prowadzi ${TODO}: imię i nazwisko lub nazwa firmy, adres, NIP i REGON (jeśli dotyczy), zwany dalej „Sprzedawcą”.
2. Kontakt ze Sprzedawcą: e-mail ${TODO}: adres e-mail obsługi klienta.
3. Regulamin określa zasady zawierania umów sprzedaży produktów cyfrowych za pośrednictwem Sklepu, zasady płatności, dostawy i składania reklamacji.
4. Kupujący przed złożeniem zamówienia ma obowiązek zapoznać się z Regulaminem i go zaakceptować.

## §2. Definicje

1. **Kupujący** – osoba fizyczna, osoba prawna lub jednostka organizacyjna składająca zamówienie.
2. **Konsument** – Kupujący będący osobą fizyczną, dokonujący zakupu niezwiązanego bezpośrednio z jego działalnością gospodarczą lub zawodową. Przepisy dotyczące Konsumenta stosuje się także do osoby fizycznej prowadzącej działalność gospodarczą, gdy umowa nie ma dla niej charakteru zawodowego.
3. **Produkt cyfrowy** – treść cyfrowa dostarczana w formie elektronicznej, w szczególności klucz aktywacyjny, kod, plik lub inny zasób cyfrowy.
4. **Zamówienie** – oświadczenie woli Kupującego zmierzające do zawarcia umowy sprzedaży Produktu cyfrowego.

## §3. Wymagania techniczne

Do korzystania ze Sklepu potrzebne są: urządzenie z dostępem do internetu, aktualna przeglądarka internetowa, aktywny adres e-mail oraz portfel kryptowalutowy umożliwiający wysłanie płatności w wybranej sieci.

## §4. Produkty

1. Sklep sprzedaje wyłącznie Produkty cyfrowe, do których dystrybucji Sprzedawca posiada prawo.
2. Opis produktu wskazuje platformę, region, wymagania oraz ograniczenia (np. regionalne lub wiekowe). Kupujący ma obowiązek zapoznać się z nimi przed zakupem.
3. Do korzystania z niektórych Produktów cyfrowych może być wymagane konto na platformie podmiotu trzeciego (np. sklepu z grami). Korzystanie z takiej platformy odbywa się na zasadach określonych przez jej operatora.
4. Ceny podane są w walucie wskazanej w Sklepie i są cenami brutto ${TODO}: potwierdź, czy jesteś płatnikiem VAT; jeśli nie — wpisz „Sprzedawca nie jest płatnikiem VAT”.

## §5. Zamówienia i zawarcie umowy

1. W celu złożenia Zamówienia Kupujący dodaje produkty do koszyka, podaje adres e-mail, wybiera kryptowalutę i sieć płatności, akceptuje Regulamin i wyraża zgodę na natychmiastowe dostarczenie treści cyfrowej.
2. Umowa zostaje zawarta z chwilą otrzymania przez Sprzedawcę pełnej płatności potwierdzonej w sieci blockchain.
3. Kupujący ponosi odpowiedzialność za podanie prawidłowego adresu e-mail. Na ten adres wysyłane są informacje o zamówieniu i link do odbioru produktów.

## §6. Płatności

1. Sklep przyjmuje płatności **wyłącznie w kryptowalutach** i sieciach wskazanych podczas składania zamówienia.
2. Kwota do zapłaty w kryptowalucie jest wyliczana według bieżącego kursu w chwili złożenia zamówienia i jest ważna przez czas wskazany na stronie płatności.
3. Kupujący jest zobowiązany wysłać **dokładnie wskazaną kwotę**, w **wskazanej sieci**, na **wskazany adres**, przed upływem terminu płatności. Opłaty sieciowe (tzw. gas/fee) ponosi Kupujący i nie mogą one pomniejszać kwoty, która dotrze do Sprzedawcy.
4. Zamówienie uznaje się za opłacone po uzyskaniu wymaganej liczby potwierdzeń w sieci blockchain.
5. Transakcje w sieciach blockchain są nieodwracalne. Sprzedawca nie ma możliwości odzyskania środków wysłanych na niewłaściwy adres, w niewłaściwej sieci lub w niewłaściwym tokenie.
6. **Niedopłata** – jeśli otrzymana kwota jest niższa od wymaganej, Kupujący może dopłacić brakującą kwotę przed upływem terminu. Po upływie terminu Sprzedawca, według wyboru Kupującego, realizuje zamówienie po dopłacie albo zwraca otrzymane środki pomniejszone o koszt transakcji zwrotnej.
7. **Nadpłata** – nadwyżka jest zwracana na wniosek Kupującego, pomniejszona o koszt transakcji zwrotnej, jeżeli nadwyżka przewyższa ten koszt.
8. **Płatność po terminie** – płatność otrzymana po upływie terminu może zostać zaakceptowana albo zwrócona; w razie istotnej zmiany kursu Sprzedawca może zaproponować dopłatę lub zwrot.

## §7. Dostawa

1. Produkty cyfrowe dostarczane są automatycznie po potwierdzeniu płatności, poprzez bezpieczną stronę zamówienia, do której link wysyłany jest na adres e-mail Kupującego.
2. Dostęp do strony odbioru jest ograniczony czasowo (domyślnie ${TODO}: liczba dni, np. 30 dni). Po tym czasie ponowny dostęp można uzyskać, kontaktując się z obsługą.
3. W wyjątkowych przypadkach (np. chwilowy brak produktu w magazynie) dostawa może się opóźnić. Kupujący zostanie o tym poinformowany e-mailem i otrzyma produkt niezwłocznie po uzupełnieniu magazynu albo — na swoje żądanie — zwrot płatności.
4. Kupujący zobowiązuje się nie udostępniać linku do zamówienia osobom trzecim.

## §8. Prawo odstąpienia od umowy

1. Konsumentowi co do zasady przysługuje prawo odstąpienia od umowy zawartej na odległość w terminie 14 dni bez podania przyczyny.
2. Zgodnie z art. 38 ust. 1 pkt 13 ustawy z dnia 30 maja 2014 r. o prawach konsumenta prawo odstąpienia **nie przysługuje** w odniesieniu do umowy o dostarczanie treści cyfrowych niedostarczanych na nośniku materialnym, jeżeli spełnianie świadczenia rozpoczęło się za wyraźną zgodą Konsumenta przed upływem terminu do odstąpienia od umowy i po poinformowaniu go o utracie prawa odstąpienia, a przedsiębiorca przekazał Konsumentowi potwierdzenie tej zgody.
3. Składając zamówienie, Kupujący wyraża zgodę na natychmiastowe dostarczenie treści cyfrowej i przyjmuje do wiadomości utratę prawa odstąpienia. Potwierdzenie tej zgody jest przesyłane e-mailem wraz z potwierdzeniem zamówienia.

## §9. Brak gwarancji i ograniczenie odpowiedzialności

1. **Sprzedawca nie udziela żadnej gwarancji** (w tym gwarancji handlowej ani dodatkowych zapewnień) na sprzedawane Produkty cyfrowe. Produkty sprzedawane są w stanie i z funkcjonalnością opisaną na stronie produktu.
2. Sprzedawca nie odpowiada za:
   1. działania lub zaniechania operatorów platform podmiotów trzecich (np. blokady kont, zmiany zasad, wyłączenie usług, ograniczenia regionalne opisane na stronie produktu),
   2. korzystanie z Produktu w sposób sprzeczny z jego opisem, wymaganiami lub zasadami platformy, której dotyczy,
   3. skutki podania przez Kupującego błędnego adresu e-mail lub udostępnienia linku do zamówienia osobom trzecim,
   4. środki wysłane na niewłaściwy adres, w niewłaściwej sieci lub w niewłaściwej kwocie,
   5. aktywację lub wykorzystanie kodu przez Kupującego lub osobę, której Kupujący go przekazał.
3. Wobec Kupujących niebędących Konsumentami: odpowiedzialność Sprzedawcy z tytułu rękojmi za wady jest wyłączona (art. 558 § 1 Kodeksu cywilnego), Sprzedawca nie odpowiada za utracone korzyści i szkody pośrednie, a łączna odpowiedzialność Sprzedawcy jest ograniczona do ceny zapłaconej za dany produkt.
4. **Postanowienia niniejszego paragrafu nie wyłączają ani nie ograniczają praw Konsumenta** wynikających z bezwzględnie obowiązujących przepisów prawa, w szczególności odpowiedzialności Sprzedawcy za zgodność treści cyfrowej z umową (rozdział 5b ustawy o prawach konsumenta). W zakresie, w jakim przepisy te przyznają Konsumentowi uprawnienia, stosuje się je w pierwszej kolejności.

## §10. Reklamacje

1. Reklamacje można składać na adres e-mail ${TODO}: adres e-mail, podając numer zamówienia i opis problemu.
2. Sprzedawca rozpatruje reklamację w terminie 14 dni od jej otrzymania i informuje o wyniku na adres e-mail Kupującego.
3. W przypadku uznania reklamacji Sprzedawca, według możliwości, dostarcza nowy, prawidłowy Produkt cyfrowy albo zwraca zapłaconą kwotę w kryptowalucie użytej do płatności (na adres wskazany przez Kupującego) lub w inny uzgodniony sposób.

## §11. Dane osobowe

Zasady przetwarzania danych osobowych opisuje [Polityka prywatności](/strona/polityka-prywatnosci).

## §12. Postanowienia końcowe

1. W sprawach nieuregulowanych stosuje się przepisy prawa polskiego, w szczególności Kodeksu cywilnego i ustawy o prawach konsumenta.
2. Konsument może skorzystać z pozasądowych sposobów rozpatrywania reklamacji i dochodzenia roszczeń, m.in. pomocy miejskiego (powiatowego) rzecznika konsumentów lub stałego polubownego sądu konsumenckiego przy Wojewódzkim Inspektoracie Inspekcji Handlowej.
3. Sprzedawca może zmienić Regulamin z ważnych przyczyn (np. zmiana przepisów). Do zamówień złożonych przed zmianą stosuje się Regulamin w dotychczasowym brzmieniu.
4. Regulamin obowiązuje od ${TODO}: data.
`,
  },
  {
    slug: 'polityka-prywatnosci', title: 'Polityka prywatności', sort: 2, body: `> **Uwaga dla właściciela sklepu:** uzupełnij pola ${TODO} i sprawdź dokument z prawnikiem (RODO).

## 1. Administrator danych

Administratorem danych osobowych jest ${TODO}: imię i nazwisko lub nazwa firmy, adres. Kontakt w sprawach danych osobowych: ${TODO}: e-mail.

## 2. Jakie dane zbieramy i po co

| Dane | Cel | Podstawa prawna (RODO) |
|---|---|---|
| Adres e-mail | realizacja zamówienia, wysyłka produktów i informacji o zamówieniu | art. 6 ust. 1 lit. b (umowa) |
| Dane zamówienia i płatności (produkty, kwoty, adres portfela i identyfikator transakcji) | realizacja umowy, rozliczenia, obowiązki podatkowe i księgowe | art. 6 ust. 1 lit. b i c |
| Pseudonimizowany skrót adresu IP, logi bezpieczeństwa | ochrona sklepu przed nadużyciami i atakami | art. 6 ust. 1 lit. f (uzasadniony interes) |

Nie prowadzimy kont klientów, nie zbieramy imion, nazwisk, adresów ani numerów telefonów, jeśli nie są potrzebne.

## 3. Jak długo przechowujemy dane

- dane zamówień — przez okres wymagany przepisami podatkowymi i rachunkowymi (zwykle 5 lat od końca roku, w którym nastąpiła sprzedaż),
- logi bezpieczeństwa — do 90 dni,
- dane techniczne sesji — do 7 dni.

## 4. Odbiorcy danych

Dane mogą być przekazywane wyłącznie podmiotom niezbędnym do działania sklepu: dostawcy hostingu ${TODO}, dostawcy poczty e-mail ${TODO}, dostawcy ochrony sieci (np. Cloudflare) ${TODO}, a w przypadku wybrania płatności przez procesora — operatorowi płatności ${TODO}. Transakcje w sieciach blockchain są publiczne z natury tych sieci.

## 5. Twoje prawa

Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia oraz wniesienia sprzeciwu, a także prawo skargi do Prezesa Urzędu Ochrony Danych Osobowych. Niektóre dane musimy przechowywać mimo żądania usunięcia, jeśli wymagają tego przepisy (np. podatkowe).

## 6. Pliki cookie

Sklep używa wyłącznie niezbędnych plików cookie: identyfikatora sesji (koszyk) i tokenu bezpieczeństwa formularzy. Nie używamy cookie reklamowych ani analitycznych, dlatego nie wyświetlamy banera zgód.
`,
  },
  {
    slug: 'dostawa', title: 'Dostawa produktów cyfrowych', sort: 3, body: `## Jak otrzymam produkt?

1. Po złożeniu zamówienia zobaczysz stronę płatności z adresem, kwotą i kodem QR.
2. Gdy Twoja transakcja zdobędzie wymaganą liczbę potwierdzeń w sieci blockchain, zamówienie zostanie automatycznie zrealizowane.
3. Otrzymasz e-mail z linkiem do bezpiecznej strony zamówienia, na której odbierzesz klucz, kod lub plik.

## Ile to trwa?

Zwykle kilka minut od wysłania płatności — zależy to od sieci (np. Tron ok. 1 min, Litecoin ok. 10 min, Bitcoin ok. 20–60 min).

## Dostęp do zamówienia

Strona odbioru jest dostępna przez ograniczony czas (domyślnie 30 dni). Klucze nie są wysyłane w treści e-maila ani umieszczane w adresach URL — dla Twojego bezpieczeństwa.

## Nie dostałem e-maila

Sprawdź folder SPAM. Jeśli wiadomości nadal nie ma, użyj strony [Znajdź zamówienie](/zamowienie) albo napisz do nas.
`,
  },
  {
    slug: 'reklamacje-i-zwroty', title: 'Reklamacje i zwroty', sort: 4, body: `## Reklamacje

Jeśli otrzymany produkt nie działa zgodnie z opisem, napisz na ${TODO}: e-mail obsługi i podaj:

- numer zamówienia (np. NI-XXXXXXXX),
- opis problemu oraz zrzut ekranu komunikatu błędu (jeśli to możliwe).

Odpowiemy w ciągu 14 dni. Szczegółowe zasady opisuje [Regulamin](/strona/regulamin) (§10).

## Zwroty płatności w kryptowalutach

- Zwroty realizujemy w tej samej kryptowalucie i sieci, w której dokonano płatności, na adres wskazany przez Ciebie w wiadomości e-mail.
- Kwota zwrotu w krypto jest równa otrzymanej kwocie pomniejszonej o koszt transakcji zwrotnej w danej sieci.
- Nie możemy zwrócić środków na adres giełdy, z której wysłano płatność, bez podania przez Ciebie adresu do zwrotu.

## Prawo odstąpienia

Przy zakupie treści cyfrowych prawo odstąpienia od umowy wygasa z chwilą rozpoczęcia dostawy za Twoją zgodą — zobacz [Regulamin](/strona/regulamin) (§8).
`,
  },
  {
    slug: 'platnosci', title: 'Płatności kryptowalutami', sort: 5, body: `## Jak zapłacić?

1. W kasie wybierz kryptowalutę **i sieć** (np. USDT w sieci Tron TRC-20).
2. Wyślij **dokładnie** wskazaną kwotę na wskazany adres przed upływem terminu (zwykle 30 minut).
3. Strona zamówienia sama się odświeży, gdy płatność zostanie wykryta i potwierdzona.

## Najważniejsze zasady

- **Sprawdź sieć.** Wysłanie środków w innej sieci (np. USDT ERC-20 zamiast TRC-20) oznacza ich utratę.
- **Wyślij dokładną kwotę.** Końcówka kwoty identyfikuje Twoje zamówienie. Jeśli wysyłasz z giełdy, upewnij się, że opłata za wypłatę nie zostanie odjęta od wysyłanej kwoty.
- **Płać przed terminem.** Kurs jest gwarantowany tylko do upływu terminu płatności.
- **Dopłata.** Jeśli wyślesz za mało, możesz dopłacić brakującą kwotę na ten sam adres przed upływem terminu.

## Wysłałem inną kwotę albo po terminie

Na stronie zamówienia możesz zgłosić identyfikator (hash) swojej transakcji. Obsługa sprawdzi ją i przypisze ręcznie.
`,
  },
  {
    slug: 'kontakt', title: 'Kontakt', sort: 6, body: `## Obsługa klienta

- E-mail: ${TODO}: adres e-mail obsługi
- Godziny pracy: ${TODO}: np. pon.–pt. 10:00–18:00

W wiadomości zawsze podawaj numer zamówienia.

## Dane sprzedawcy

${TODO}: imię i nazwisko lub nazwa firmy, adres, NIP (jeśli dotyczy). Konsument ma prawo znać tożsamość sprzedawcy — tych danych nie można pominąć.
`,
  },
  {
    slug: 'faq', title: 'Najczęstsze pytania', sort: 7, body: `## Czy muszę zakładać konto?

Nie. Wystarczy adres e-mail — na niego wyślemy link do zamówienia.

## Jakie kryptowaluty przyjmujecie?

Aktualna lista jest widoczna w kasie. Zawsze zwracaj uwagę na sieć (np. TRC-20, ERC-20).

## Ile czekam na produkt?

Dostawa jest automatyczna po potwierdzeniu transakcji w sieci blockchain — zwykle od kilku do kilkudziesięciu minut.

## Klucz nie działa. Co robić?

Sprawdź region i wymagania podane w opisie produktu, a następnie napisz do nas z numerem zamówienia — zobacz [Reklamacje i zwroty](/strona/reklamacje-i-zwroty).
`,
  },
];

const CATEGORIES = [
  ['Discord', 'discord', 'Nitro, boosty serwerów i inne produkty związane z Discordem.'],
  ['Streaming', 'streaming', 'Subskrypcje i kody do serwisów streamingowych.'],
  ['Gry', 'gry', 'Klucze do gier, karty podarunkowe i waluty w grach.'],
  ['AI', 'ai', 'Subskrypcje i kredyty do narzędzi sztucznej inteligencji.'],
  ['VPN', 'vpn', 'Licencje i subskrypcje usług VPN.'],
  ['Muzyka', 'muzyka', 'Subskrypcje i kody do serwisów muzycznych.'],
  ['Cheaty', 'cheaty', 'Oprogramowanie dodatkowe do gier.'],
  ['Social Boost', 'social-boost', 'Usługi promocji w mediach społecznościowych.'],
];

const PLATFORMS = [
  ['Steam', 'steam', '#66c0f4'], ['PlayStation', 'playstation', '#4b7bec'], ['Xbox', 'xbox', '#3ec46d'],
  ['Nintendo', 'nintendo', '#ff5a5f'], ['Epic Games', 'epic-games', '#d9d9d9'], ['EA app', 'ea-app', '#ff6b4a'],
  ['Ubisoft Connect', 'ubisoft-connect', '#5aa9ff'], ['Battle.net', 'battle-net', '#3fa9f5'],
  ['Roblox', 'roblox', '#e8e8e8'], ['Minecraft', 'minecraft', '#7bc96f'], ['Windows', 'windows', '#00a4ef'], ['Inne', 'inne', '#c6f432'],
];

function ensureBase() {
  const conn = db.get();
  conn.transaction(() => {
    const insPage = conn.prepare('INSERT OR IGNORE INTO pages (slug, title, body_md, sort) VALUES (?,?,?,?)');
    for (const p of PAGES) insPage.run(p.slug, p.title, p.body, p.sort);
    if (settings.get('seed.base_done') !== '1') {
      const insCat = conn.prepare('INSERT OR IGNORE INTO categories (name, slug, description, sort) VALUES (?,?,?,?)');
      CATEGORIES.forEach(([n, s, d], i) => insCat.run(n, s, d, i));
      const insPl = conn.prepare('INSERT OR IGNORE INTO platforms (name, slug, color, sort) VALUES (?,?,?,?)');
      PLATFORMS.forEach(([n, s, c], i) => insPl.run(n, s, c, i));
      settings.set('seed.base_done', '1');
    }
  })();
}

module.exports = { ensureBase, PAGES };
