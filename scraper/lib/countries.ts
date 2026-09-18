/**
 * Canonical country metadata for the 50 target markets plus a multilingual alias table used to
 * normalise whatever the extractor returns ("Deutschland", "日本", "Česko", …) to a canonical
 * English name + ISO alpha-2 code. Also used to pick the default calling country when parsing
 * local-format phone numbers.
 */

import type { CountryCode } from "libphonenumber-js";

export type RegionKey =
  | "europe-west"
  | "europe-central"
  | "europe-south"
  | "europe-north"
  | "balkans"
  | "caucasus"
  | "japan"
  | "korea"
  | "asia-other"
  | "mena";

export interface CountryInfo {
  name: string;
  code: CountryCode;
  region: RegionKey;
  /** BCP-47 tags most guide sites in this country publish in, used for Firecrawl `location.languages` */
  languages: string[];
  /** slug used by TourHQ / GoWithGuide style directories */
  slug: string;
  aliases: string[];
  /** major tourist cities used for search discovery queries */
  cities: string[];
  /** localised search terms for "driver guide" */
  localTerms: string[];
}

export const COUNTRIES: CountryInfo[] = [
  // ---- Western Europe -----------------------------------------------------------------------
  { name: "Portugal", code: "PT", region: "europe-west", languages: ["pt", "en"], slug: "portugal", aliases: ["portugal", "португалия", "ポルトガル", "포르투갈"], cities: ["Lisbon", "Porto", "Algarve", "Sintra"], localTerms: ["motorista guia", "guia privado com carro", "motorista particular turismo"] },
  { name: "Spain", code: "ES", region: "europe-west", languages: ["es", "en"], slug: "spain", aliases: ["spain", "españa", "espana", "espagne", "spanien", "spagna", "spanje", "hiszpania", "španělsko", "spanyolország", "испания", "ισπανία", "i̇spanya", "スペイン", "스페인"], cities: ["Madrid", "Barcelona", "Seville", "Granada", "Valencia", "Malaga"], localTerms: ["conductor guía", "chofer guía turístico", "guía privado con coche", "chófer privado turismo"] },
  { name: "France", code: "FR", region: "europe-west", languages: ["fr", "en"], slug: "france", aliases: ["france", "frankreich", "francia", "frança", "frankrijk", "francja", "francie", "franciaország", "франция", "γαλλία", "fransa", "フランス", "프랑스"], cities: ["Paris", "Nice", "Lyon", "Bordeaux", "Marseille", "Strasbourg"], localTerms: ["chauffeur guide", "guide chauffeur privé", "chauffeur privé touristique", "guide conférencier avec véhicule"] },
  { name: "Belgium", code: "BE", region: "europe-west", languages: ["nl", "fr", "en"], slug: "belgium", aliases: ["belgium", "belgië", "belgie", "belgique", "belgien", "belgio", "bélgica", "belgia", "бельгия", "ベルギー", "벨기에"], cities: ["Brussels", "Bruges", "Antwerp", "Ghent"], localTerms: ["chauffeur gids", "chauffeur guide", "privé chauffeur toerisme", "gids met auto"] },
  { name: "Netherlands", code: "NL", region: "europe-west", languages: ["nl", "en"], slug: "netherlands", aliases: ["netherlands", "the netherlands", "holland", "nederland", "niederlande", "pays-bas", "paesi bassi", "países bajos", "holandia", "nizozemsko", "нидерланды", "голландия", "オランダ", "네덜란드"], cities: ["Amsterdam", "Rotterdam", "Utrecht", "The Hague"], localTerms: ["chauffeur gids", "privé gids met auto", "privéchauffeur toerisme"] },
  { name: "Luxembourg", code: "LU", region: "europe-west", languages: ["fr", "de", "en"], slug: "luxembourg", aliases: ["luxembourg", "luxemburg", "lussemburgo", "luxemburgo", "люксембург", "ルクセンブルク", "룩셈부르크"], cities: ["Luxembourg City"], localTerms: ["chauffeur guide", "fahrer reiseleiter"] },
  { name: "Andorra", code: "AD", region: "europe-west", languages: ["ca", "es", "fr"], slug: "andorra", aliases: ["andorra", "andorre", "андорра", "アンドラ", "안도라"], cities: ["Andorra la Vella"], localTerms: ["conductor guía", "chauffeur guide"] },
  { name: "Monaco", code: "MC", region: "europe-west", languages: ["fr", "en"], slug: "monaco", aliases: ["monaco", "mónaco", "монако", "モナコ", "모나코"], cities: ["Monte Carlo"], localTerms: ["chauffeur guide", "chauffeur privé"] },

  // ---- Central Europe -----------------------------------------------------------------------
  { name: "Germany", code: "DE", region: "europe-central", languages: ["de", "en"], slug: "germany", aliases: ["germany", "deutschland", "allemagne", "germania", "alemania", "alemanha", "duitsland", "niemcy", "německo", "németország", "германия", "γερμανία", "almanya", "ドイツ", "독일"], cities: ["Berlin", "Munich", "Frankfurt", "Hamburg", "Cologne", "Heidelberg"], localTerms: ["Fahrer und Reiseleiter", "Reiseleiter mit eigenem Fahrzeug", "Fahrer-Guide", "privater Chauffeur Stadtführung"] },
  { name: "Switzerland", code: "CH", region: "europe-central", languages: ["de", "fr", "it", "en"], slug: "switzerland", aliases: ["switzerland", "schweiz", "suisse", "svizzera", "suiza", "suíça", "zwitserland", "szwajcaria", "švýcarsko", "svájc", "швейцария", "ελβετία", "i̇sviçre", "スイス", "스위스"], cities: ["Zurich", "Lucerne", "Interlaken", "Geneva", "Zermatt", "Bern"], localTerms: ["Fahrer und Reiseleiter", "chauffeur guide", "private driver guide Interlaken", "Reiseleiter mit Auto"] },
  { name: "Austria", code: "AT", region: "europe-central", languages: ["de", "en"], slug: "austria", aliases: ["austria", "österreich", "oesterreich", "autriche", "áustria", "oostenrijk", "rakousko", "ausztria", "австрия", "αυστρία", "avusturya", "オーストリア", "오스트리아"], cities: ["Vienna", "Salzburg", "Innsbruck", "Hallstatt"], localTerms: ["Fahrer und Reiseleiter", "Fremdenführer mit Auto", "Chauffeur Guide Wien"] },
  { name: "Liechtenstein", code: "LI", region: "europe-central", languages: ["de", "en"], slug: "liechtenstein", aliases: ["liechtenstein", "лихтенштейн", "リヒテンシュタイン", "리히텐슈타인"], cities: ["Vaduz"], localTerms: ["Fahrer Reiseleiter"] },
  { name: "Poland", code: "PL", region: "europe-central", languages: ["pl", "en"], slug: "poland", aliases: ["poland", "polska", "polen", "pologne", "polonia", "polónia", "polsko", "lengyelország", "польша", "πολωνία", "polonya", "ポーランド", "폴란드"], cities: ["Warsaw", "Krakow", "Gdansk", "Wroclaw"], localTerms: ["kierowca przewodnik", "przewodnik z samochodem", "prywatny kierowca turystyczny"] },
  { name: "Czech Republic", code: "CZ", region: "europe-central", languages: ["cs", "en"], slug: "czech-republic", aliases: ["czech republic", "czechia", "česko", "česká republika", "tschechien", "république tchèque", "repubblica ceca", "república checa", "tsjechië", "czechy", "csehország", "чехия", "τσεχία", "çekya", "チェコ", "체코"], cities: ["Prague", "Brno", "Cesky Krumlov", "Karlovy Vary"], localTerms: ["řidič průvodce", "průvodce s autem", "soukromý řidič průvodce Praha"] },
  { name: "Slovakia", code: "SK", region: "europe-central", languages: ["sk", "en"], slug: "slovakia", aliases: ["slovakia", "slovensko", "slowakei", "slovaquie", "slovacchia", "eslovaquia", "slowakije", "słowacja", "szlovákia", "словакия", "スロバキア", "슬로바키아"], cities: ["Bratislava", "Kosice"], localTerms: ["vodič sprievodca", "sprievodca s autom"] },
  { name: "Hungary", code: "HU", region: "europe-central", languages: ["hu", "en"], slug: "hungary", aliases: ["hungary", "magyarország", "ungarn", "hongrie", "ungheria", "hungría", "hongarije", "węgry", "maďarsko", "венгрия", "ουγγαρία", "macaristan", "ハンガリー", "헝가리"], cities: ["Budapest", "Eger", "Balaton"], localTerms: ["sofőr idegenvezető", "idegenvezető autóval", "privát sofőr Budapest"] },

  // ---- Southern Europe ----------------------------------------------------------------------
  { name: "Italy", code: "IT", region: "europe-south", languages: ["it", "en"], slug: "italy", aliases: ["italy", "italia", "italien", "italie", "itália", "italië", "włochy", "itálie", "olaszország", "италия", "ιταλία", "i̇talya", "イタリア", "이탈리아"], cities: ["Rome", "Florence", "Venice", "Milan", "Naples", "Amalfi", "Tuscany", "Sicily"], localTerms: ["autista guida", "guida autista privato", "NCC con guida", "noleggio con conducente turistico"] },
  { name: "San Marino", code: "SM", region: "europe-south", languages: ["it", "en"], slug: "san-marino", aliases: ["san marino", "сан-марино", "サンマリノ", "산마리노"], cities: ["San Marino"], localTerms: ["autista guida"] },
  { name: "Greece", code: "GR", region: "europe-south", languages: ["el", "en"], slug: "greece", aliases: ["greece", "ελλάδα", "ελλας", "hellas", "griechenland", "grèce", "grecia", "grécia", "griekenland", "grecja", "řecko", "görögország", "греция", "yunanistan", "ギリシャ", "그리스"], cities: ["Athens", "Santorini", "Mykonos", "Thessaloniki", "Crete", "Rhodes"], localTerms: ["οδηγός ξεναγός", "ιδιωτικός οδηγός τουρισμός", "driver guide Athens"] },
  { name: "Cyprus", code: "CY", region: "europe-south", languages: ["el", "en"], slug: "cyprus", aliases: ["cyprus", "κύπρος", "zypern", "chypre", "cipro", "chipre", "cypr", "kypr", "ciprus", "кипр", "kıbrıs", "キプロス", "키프로스"], cities: ["Limassol", "Paphos", "Larnaca", "Nicosia"], localTerms: ["driver guide Cyprus", "οδηγός ξεναγός Κύπρος"] },
  { name: "Turkey", code: "TR", region: "europe-south", languages: ["tr", "en"], slug: "turkey", aliases: ["turkey", "türkiye", "turkiye", "türkei", "turquie", "turchia", "turquía", "turquia", "turkije", "turcja", "turecko", "törökország", "турция", "τουρκία", "トルコ", "터키", "튀르키예"], cities: ["Istanbul", "Cappadocia", "Antalya", "Izmir", "Ephesus", "Pamukkale"], localTerms: ["şoför rehber", "araçlı rehber", "özel şoförlü tur rehberi", "kokartlı rehber araç"] },

  // ---- Northern Europe ----------------------------------------------------------------------
  { name: "Iceland", code: "IS", region: "europe-north", languages: ["is", "en"], slug: "iceland", aliases: ["iceland", "ísland", "island", "islande", "islanda", "islandia", "islândia", "ijsland", "islandia", "исландия", "アイスランド", "아이슬란드"], cities: ["Reykjavik", "Akureyri", "Vik"], localTerms: ["driver guide Iceland", "private super jeep guide", "leiðsögumaður bílstjóri"] },
  { name: "Norway", code: "NO", region: "europe-north", languages: ["no", "en"], slug: "norway", aliases: ["norway", "norge", "noreg", "norwegen", "norvège", "norvegia", "noruega", "noorwegen", "norwegia", "norsko", "norvégia", "норвегия", "ノルウェー", "노르웨이"], cities: ["Oslo", "Bergen", "Tromso", "Stavanger", "Flam"], localTerms: ["sjåfør guide", "privat guide med bil", "driver guide fjords"] },
  { name: "Sweden", code: "SE", region: "europe-north", languages: ["sv", "en"], slug: "sweden", aliases: ["sweden", "sverige", "schweden", "suède", "svezia", "suecia", "suécia", "zweden", "szwecja", "švédsko", "svédország", "швеция", "スウェーデン", "스웨덴"], cities: ["Stockholm", "Gothenburg", "Malmo", "Kiruna"], localTerms: ["chaufför guide", "privat guide med bil", "auktoriserad guide bil"] },
  { name: "Denmark", code: "DK", region: "europe-north", languages: ["da", "en"], slug: "denmark", aliases: ["denmark", "danmark", "dänemark", "danemark", "danimarca", "dinamarca", "denemarken", "dania", "dánsko", "dánia", "дания", "デンマーク", "덴마크"], cities: ["Copenhagen", "Aarhus", "Odense"], localTerms: ["chauffør guide", "privat guide med bil"] },
  { name: "Finland", code: "FI", region: "europe-north", languages: ["fi", "en"], slug: "finland", aliases: ["finland", "suomi", "finnland", "finlande", "finlandia", "finlândia", "finlandia", "finsko", "finnország", "финляндия", "フィンランド", "핀란드"], cities: ["Helsinki", "Rovaniemi", "Lapland", "Turku"], localTerms: ["kuljettaja opas", "yksityinen opas autolla", "driver guide Lapland"] },
  { name: "Estonia", code: "EE", region: "europe-north", languages: ["et", "en"], slug: "estonia", aliases: ["estonia", "eesti", "estland", "estonie", "estónia", "estonsko", "észtország", "эстония", "エストニア", "에스토니아"], cities: ["Tallinn", "Tartu", "Parnu"], localTerms: ["giid autoga", "autojuht giid", "driver guide Tallinn"] },
  { name: "Latvia", code: "LV", region: "europe-north", languages: ["lv", "en"], slug: "latvia", aliases: ["latvia", "latvija", "lettland", "lettonie", "lettonia", "letonia", "letland", "łotwa", "lotyšsko", "lettország", "латвия", "ラトビア", "라트비아"], cities: ["Riga", "Jurmala", "Sigulda"], localTerms: ["gids ar auto", "šoferis gids", "driver guide Riga"] },
  { name: "Lithuania", code: "LT", region: "europe-north", languages: ["lt", "en"], slug: "lithuania", aliases: ["lithuania", "lietuva", "litauen", "lituanie", "lituania", "lituânia", "litouwen", "litwa", "litva", "litvánia", "литва", "リトアニア", "리투아니아"], cities: ["Vilnius", "Kaunas", "Klaipeda"], localTerms: ["gidas su automobiliu", "vairuotojas gidas", "driver guide Vilnius"] },

  // ---- Balkans & Eastern Europe -------------------------------------------------------------
  { name: "Slovenia", code: "SI", region: "balkans", languages: ["sl", "en"], slug: "slovenia", aliases: ["slovenia", "slovenija", "slowenien", "slovénie", "eslovenia", "eslovénia", "slovenië", "słowenia", "slovinsko", "szlovénia", "словения", "スロベニア", "슬로베니아"], cities: ["Ljubljana", "Bled", "Piran"], localTerms: ["voznik vodnik", "turistični vodnik z avtom", "driver guide Ljubljana"] },
  { name: "Croatia", code: "HR", region: "balkans", languages: ["hr", "en"], slug: "croatia", aliases: ["croatia", "hrvatska", "kroatien", "croatie", "croazia", "croacia", "croácia", "kroatië", "chorwacja", "chorvatsko", "horvátország", "хорватия", "κροατία", "hırvatistan", "クロアチア", "크로아티아"], cities: ["Dubrovnik", "Split", "Zagreb", "Zadar", "Plitvice"], localTerms: ["vozač vodič", "turistički vodič s automobilom", "privatni vozač turistički"] },
  { name: "Bosnia and Herzegovina", code: "BA", region: "balkans", languages: ["bs", "hr", "sr", "en"], slug: "bosnia-and-herzegovina", aliases: ["bosnia", "bosnia and herzegovina", "bosna i hercegovina", "bosnien", "bosnie", "bosnia ed erzegovina", "bosnia y herzegovina", "босния", "ボスニア", "보스니아"], cities: ["Sarajevo", "Mostar", "Banja Luka"], localTerms: ["vozač vodič", "turistički vodič sa autom"] },
  { name: "Serbia", code: "RS", region: "balkans", languages: ["sr", "en"], slug: "serbia", aliases: ["serbia", "srbija", "србија", "serbien", "serbie", "сербия", "σερβία", "sırbistan", "セルビア", "세르비아"], cities: ["Belgrade", "Novi Sad", "Nis"], localTerms: ["vozač vodič", "turistički vodič sa automobilom", "privatni vozač Beograd"] },
  { name: "Montenegro", code: "ME", region: "balkans", languages: ["sr", "en"], slug: "montenegro", aliases: ["montenegro", "crna gora", "црна гора", "černá hora", "черногория", "karadağ", "モンテネグロ", "몬테네그로"], cities: ["Kotor", "Budva", "Podgorica", "Tivat"], localTerms: ["vozač vodič", "privatni vozač turistički"] },
  { name: "North Macedonia", code: "MK", region: "balkans", languages: ["mk", "en"], slug: "north-macedonia", aliases: ["north macedonia", "macedonia", "северна македонија", "македонија", "nordmazedonien", "macédoine", "macedonia del nord", "северная македония", "北マケドニア", "북마케도니아"], cities: ["Skopje", "Ohrid", "Bitola"], localTerms: ["возач водич", "туристички водич со автомобил"] },
  { name: "Albania", code: "AL", region: "balkans", languages: ["sq", "en"], slug: "albania", aliases: ["albania", "shqipëri", "shqiperia", "albanien", "albanie", "албания", "αλβανία", "arnavutluk", "アルバニア", "알바니아"], cities: ["Tirana", "Saranda", "Berat", "Gjirokaster"], localTerms: ["shofer udhërrëfyes", "guidë turistike me makinë", "driver guide Albania"] },
  { name: "Kosovo", code: "XK", region: "balkans", languages: ["sq", "sr", "en"], slug: "kosovo", aliases: ["kosovo", "kosova", "косово", "コソボ", "코소보"], cities: ["Pristina", "Prizren", "Peja"], localTerms: ["shofer udhërrëfyes", "driver guide Kosovo"] },
  { name: "Bulgaria", code: "BG", region: "balkans", languages: ["bg", "en"], slug: "bulgaria", aliases: ["bulgaria", "българия", "bulgarien", "bulgarie", "bulgária", "bulgarije", "bułgaria", "bulharsko", "bulgária", "болгария", "βουλγαρία", "bulgaristan", "ブルガリア", "불가리아"], cities: ["Sofia", "Plovdiv", "Varna", "Veliko Tarnovo"], localTerms: ["шофьор екскурзовод", "екскурзовод с автомобил", "частен шофьор туризъм"] },
  { name: "Romania", code: "RO", region: "balkans", languages: ["ro", "en"], slug: "romania", aliases: ["romania", "românia", "rumänien", "roumanie", "rumania", "rumanía", "roménia", "roemenië", "rumunia", "rumunsko", "románia", "румыния", "ρουμανία", "romanya", "ルーマニア", "루마니아"], cities: ["Bucharest", "Brasov", "Cluj-Napoca", "Sibiu", "Transylvania"], localTerms: ["șofer ghid", "ghid turistic cu mașină", "șofer privat turism"] },
  { name: "Moldova", code: "MD", region: "balkans", languages: ["ro", "ru", "en"], slug: "moldova", aliases: ["moldova", "republica moldova", "moldawien", "moldavie", "moldavia", "молдова", "молдавия", "モルドバ", "몰도바"], cities: ["Chisinau", "Orheiul Vechi"], localTerms: ["șofer ghid", "гид водитель Кишинев"] },

  // ---- Caucasus -----------------------------------------------------------------------------
  { name: "Georgia", code: "GE", region: "caucasus", languages: ["ka", "ru", "en"], slug: "georgia", aliases: ["georgia", "საქართველო", "georgien", "géorgie", "gruzja", "gruzie", "грузия", "gürcistan", "ジョージア", "グルジア", "조지아"], cities: ["Tbilisi", "Batumi", "Kazbegi", "Kakheti", "Kutaisi"], localTerms: ["მძღოლი გიდი", "гид водитель Грузия", "driver guide Tbilisi"] },
  { name: "Armenia", code: "AM", region: "caucasus", languages: ["hy", "ru", "en"], slug: "armenia", aliases: ["armenia", "հայաստան", "armenien", "arménie", "arménia", "армения", "ermenistan", "アルメニア", "아르메니아"], cities: ["Yerevan", "Dilijan", "Gyumri"], localTerms: ["гид водитель Армения", "driver guide Yerevan"] },
  { name: "Azerbaijan", code: "AZ", region: "caucasus", languages: ["az", "ru", "en"], slug: "azerbaijan", aliases: ["azerbaijan", "azərbaycan", "aserbaidschan", "azerbaïdjan", "azerbaigian", "azerbaiyán", "азербайджан", "アゼルバイジャン", "아제르바이잔"], cities: ["Baku", "Gabala", "Sheki"], localTerms: ["sürücü bələdçi", "гид водитель Баку", "driver guide Baku"] },

  // ---- East Asia ----------------------------------------------------------------------------
  { name: "Japan", code: "JP", region: "japan", languages: ["ja", "en"], slug: "japan", aliases: ["japan", "日本", "nippon", "nihon", "japon", "japón", "japão", "giappone", "japonia", "japonsko", "japán", "япония", "ιαπωνία", "japonya", "일본"], cities: ["Tokyo", "Kyoto", "Osaka", "Hokkaido", "Hiroshima", "Nara", "Fukuoka", "Okinawa", "Nagoya", "Mt Fuji"], localTerms: ["ドライバーガイド", "通訳案内士 車", "運転手兼ガイド", "貸切 観光タクシー ガイド", "プライベートガイド 送迎付き"] },
  { name: "South Korea", code: "KR", region: "korea", languages: ["ko", "en"], slug: "south-korea", aliases: ["south korea", "korea", "republic of korea", "대한민국", "한국", "südkorea", "corée du sud", "corea del sud", "corea del sur", "coreia do sul", "zuid-korea", "korea południowa", "jižní korea", "dél-korea", "южная корея", "güney kore", "韓国"], cities: ["Seoul", "Busan", "Jeju", "Gyeongju", "Incheon", "Gangwon"], localTerms: ["기사 겸 가이드", "관광통역안내사 차량", "프라이빗 가이드 차량", "드라이빙 가이드", "외국인 전용 택시 가이드"] },
  { name: "Taiwan", code: "TW", region: "asia-other", languages: ["zh", "en"], slug: "taiwan", aliases: ["taiwan", "台灣", "台湾", "臺灣", "тайвань", "타이완", "대만"], cities: ["Taipei", "Taichung", "Kaohsiung", "Hualien", "Taroko"], localTerms: ["司機導遊", "包車 導遊", "私人司機導覽", "driver guide Taiwan"] },

  // ---- Southeast Asia -----------------------------------------------------------------------
  { name: "Vietnam", code: "VN", region: "asia-other", languages: ["vi", "en"], slug: "vietnam", aliases: ["vietnam", "việt nam", "viet nam", "вьетнам", "ベトナム", "베트남", "越南"], cities: ["Hanoi", "Ho Chi Minh City", "Da Nang", "Hoi An", "Hue", "Ha Long"], localTerms: ["hướng dẫn viên kiêm lái xe", "lái xe kiêm hướng dẫn", "tài xế hướng dẫn viên", "driver guide Vietnam"] },
  { name: "Thailand", code: "TH", region: "asia-other", languages: ["th", "en"], slug: "thailand", aliases: ["thailand", "ประเทศไทย", "ไทย", "thaïlande", "tailandia", "tailândia", "tajlandia", "thajsko", "таиланд", "タイ", "태국", "泰国"], cities: ["Bangkok", "Phuket", "Chiang Mai", "Pattaya", "Krabi"], localTerms: ["ไกด์พร้อมรถ", "คนขับรถไกด์", "ไกด์ส่วนตัวพร้อมรถ", "driver guide Thailand"] },
  { name: "Indonesia", code: "ID", region: "asia-other", languages: ["id", "en"], slug: "indonesia", aliases: ["indonesia", "indonesien", "indonésie", "indonésia", "indonezja", "индонезия", "インドネシア", "인도네시아", "印尼"], cities: ["Bali", "Ubud", "Jakarta", "Yogyakarta", "Lombok"], localTerms: ["sopir merangkap pemandu", "driver guide Bali", "supir pemandu wisata", "sewa mobil dengan sopir guide"] },

  // ---- MENA ---------------------------------------------------------------------------------
  { name: "Egypt", code: "EG", region: "mena", languages: ["ar", "en"], slug: "egypt", aliases: ["egypt", "مصر", "ägypten", "égypte", "egitto", "egipto", "egito", "egypte", "egipt", "египет", "αίγυπτος", "mısır", "エジプト", "이집트"], cities: ["Cairo", "Luxor", "Aswan", "Hurghada", "Sharm El Sheikh", "Giza"], localTerms: ["مرشد سياحي مع سيارة", "سائق مرشد", "driver guide Cairo"] },
];

export const REGIONS: Record<RegionKey, { label: string; countryCodes: CountryCode[] }> = (() => {
  const out = {} as Record<RegionKey, { label: string; countryCodes: CountryCode[] }>;
  const labels: Record<RegionKey, string> = {
    "europe-west": "Western Europe",
    "europe-central": "Central Europe",
    "europe-south": "Southern Europe",
    "europe-north": "Northern Europe & Baltics",
    balkans: "Balkans & Eastern Europe",
    caucasus: "Caucasus",
    japan: "Japan",
    korea: "South Korea",
    "asia-other": "Taiwan & Southeast Asia",
    mena: "Middle East & North Africa",
  };
  for (const key of Object.keys(labels) as RegionKey[]) out[key] = { label: labels[key], countryCodes: [] };
  for (const c of COUNTRIES) out[c.region].countryCodes.push(c.code);
  return out;
})();

const ALIAS_INDEX = new Map<string, CountryInfo>();
for (const c of COUNTRIES) {
  ALIAS_INDEX.set(c.name.toLowerCase(), c);
  ALIAS_INDEX.set(c.code.toLowerCase(), c);
  ALIAS_INDEX.set(c.slug, c);
  for (const a of c.aliases) ALIAS_INDEX.set(a.toLowerCase(), c);
}

export function findCountry(input: string | null | undefined): CountryInfo | undefined {
  if (!input) return undefined;
  const key = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (ALIAS_INDEX.has(key)) return ALIAS_INDEX.get(key);
  // "Kyoto, Japan" / "Rome (Italy)" — take the last comma/paren token
  const tail = key.split(/[,(/|-]/).pop()?.replace(/[)\s]+$/g, "").trim();
  if (tail && ALIAS_INDEX.has(tail)) return ALIAS_INDEX.get(tail);
  // substring scan for CJK aliases that don't tokenise
  for (const [alias, info] of ALIAS_INDEX) {
    if (alias.length >= 4 && key.includes(alias)) return info;
  }
  return undefined;
}

/** Nationality label that describes the guide's own market rather than foreign clients. */
export const SELF_CLIENT_LABEL: Partial<Record<string, string>> = {
  JP: "Japanese",
  KR: "Korean",
  TW: "Chinese",
  EG: "Middle Eastern",
};

export function countryByCode(code: string | null | undefined): CountryInfo | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

/** Detect a country by scanning free text for aliases (used when the extractor returns none). */
export function detectCountryInText(text: string): CountryInfo | undefined {
  const lower = text.toLowerCase();
  let best: { info: CountryInfo; count: number } | undefined;
  for (const c of COUNTRIES) {
    const names = [c.name.toLowerCase(), ...c.aliases.filter((a) => a.length >= 4)];
    let count = 0;
    for (const n of names) {
      let idx = lower.indexOf(n);
      while (idx !== -1 && count < 50) {
        count++;
        idx = lower.indexOf(n, idx + n.length);
      }
    }
    if (count > 0 && (!best || count > best.count)) best = { info: c, count };
  }
  return best?.info;
}
