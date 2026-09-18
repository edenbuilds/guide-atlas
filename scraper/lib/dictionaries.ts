/**
 * Multilingual keyword dictionaries used to (a) validate LLM-extracted classifications against the
 * page text and (b) run the regex-only extraction mode.
 *
 * Coverage: English, German, French, Italian, Spanish, Portuguese, Dutch, Polish, Czech/Slovak,
 * Hungarian, Romanian, Bulgarian/Russian/Ukrainian (Cyrillic), Greek, Turkish, Croatian/Serbian/
 * Slovene/Bosnian, Scandinavian (sv/no/da), Finnish, Estonian/Latvian/Lithuanian, Albanian,
 * Georgian, Japanese, Korean, Thai, Vietnamese, Indonesian, Arabic.
 *
 * Patterns are matched case-insensitively with the `u` flag. Word boundaries (`\b`) are unreliable
 * for CJK / Cyrillic, so CJK entries are plain substrings and Latin entries use explicit
 * `(?<![\p{L}])` / `(?![\p{L}])` lookarounds via the `w()` helper.
 */

import type { ClientNationality, ServiceType, VehicleType } from "../../src/lib/guide-schema";

/** Wrap a Latin-script stem so it only matches at a letter boundary (prefix match allowed). */
const w = (stem: string) => `(?<![\\p{L}])${stem}`;
/** Whole-word (no suffix) match. */
const ww = (word: string) => `(?<![\\p{L}])${word}(?![\\p{L}])`;

function rx(parts: string[]): RegExp {
  return new RegExp(parts.join("|"), "iu");
}

export interface KeywordRule<T extends string> {
  label: T;
  pattern: RegExp;
  /** matches that must be absent within the same ~40 char window for the rule to fire */
  exclude?: RegExp;
}

// ---------------------------------------------------------------------------------------------
// Client nationality experience
// ---------------------------------------------------------------------------------------------

export const CLIENT_RULES: KeywordRule<ClientNationality>[] = [
  {
    label: "Indian",
    pattern: rx([
      w("indian"), // en
      ww("india"), // "clients from India"
      w("indien"), w("indienne"), // fr
      w("indisch"), ww("inder"), ww("inderin(nen)?"), // de
      w("indian[oaie]"), // it
      ww("indi[oa]s?"), w("hind[uú]"), // es (hindú is the common Spanish word for Indian nationals)
      ww("indiase"), ww("indi[eë]rs?"), // nl
      w("indyjsk"), ww("hindus[oó]?w?"), // pl
      w("indick"), // cs/sk
      w("indiai"), // hu
      w("indieni"), // ro
      "индийск", "индийц", "индиец", "индус", "індійськ", // bg/ru/uk
      "ινδ", // el
      ww("hint"), ww("hintli(ler)?"), // tr
      w("indijsk"), w("indijc"), // hr/sr/sl
      w("indisk"), ww("indier(e|ne)?"), // sv/no/da
      w("intialai"), // fi
      w("indian[eė]"), // lt/lv-ish
      w("indian[eë]"), // sq
      "ინდო", "ინდიელ", // ka
      "インド", "印度", // ja / zh
      "인도", // ko
      "อินเดีย", // th
      "ấn độ", // vi
      "هند", // ar
    ]),
    exclude: /indones|indiana|west ind|east ind|indian ocean|indian restaurant|indian food|cuisine|curry/iu,
  },
  {
    label: "American",
    pattern: rx([
      w("american"), ww("usa"), ww("u\\.s\\.a?\\.?"), "united states", ww("us clients?"),
      w("am[eé]ricain"), // fr
      w("amerikan"), ww("us-amerikan\\p{L}*"), // de / tr
      w("american[oaie]"), // it/es/pt
      w("amerikaans"), // nl
      w("amerykań"), // pl
      w("americk"), // cs/sk
      w("amerikai"), // hu
      "американ", // bg/ru
      "αμερικ", // el
      w("amerikansk"), w("amerikkalai"), // sv/no/da fi
      w("amerikanë"), // sq
      "ამერიკ", // ka
      "アメリカ", "米国", // ja
      "미국", // ko
      "อเมริก", // th
      "hoa kỳ", "mỹ", // vi
      "أمريك", // ar
    ]),
    exclude: /south\s*american|latin\s*american|sudamerican|sud-am[eé]ricain|s[uü]damerikan|latino?american|central american|native american/iu,
  },
  {
    label: "Chinese",
    pattern: rx([
      w("chinese"), ww("china"), ww("prc"),
      w("chinois"), // fr
      w("chinesisch"), ww("chinesen?"), // de
      w("cines[ei]"), // it
      w("chin[oa]s?"), // es
      w("chin[eê]s"), // pt
      w("chinezen"), // nl
      w("chińsk"), w("chińczy"), // pl
      w("čínsk"), w("číňan"), // cs/sk
      w("kínai"), // hu
      w("chinez"), // ro
      "китайск", "китайц", "китаец", // bg/ru
      "κινέζ", "κινεζ", // el
      ww("çinli(ler)?"), ww("çin"), // tr
      w("kinesk"), w("kinez"), // hr/sr
      w("kinesisk"), w("kiinalai"), // sv/no/da fi
      w("kinez"), // sq
      "ჩინ", // ka
      "中国", "中國", "中華", "华人", "華人", // zh/ja
      "중국", // ko
      "จีน", // th
      "trung quốc", // vi
      "صين", // ar
    ]),
    exclude: /chinese restaurant|chinese food|chinatown|china town|porcelain/iu,
  },
  {
    label: "British",
    pattern: rx([
      w("british"), ww("uk"), "united kingdom", ww("england"), ww("english (tourists|clients|guests|visitors)"),
      w("britannique"), w("britisch"), ww("briten"), w("britannic"), w("brit[aá]nic"), w("brits"), w("brytyjsk"),
      w("britsk"), ww("brit"), w("britanic"), "британ", "βρεταν", w("ingiliz"), w("britansk"), w("brittil"),
      "イギリス", "英国", "영국", "อังกฤษ", "anh quốc",
    ]),
  },
  {
    label: "Australian",
    pattern: rx([
      w("australian"), ww("australia"), w("australien"), w("australisch"), w("australian[oaie]"), w("australisch"),
      w("australijsk"), w("austrálsk"), w("ausztrál"), "австралий", "αυστραλ", w("avustralya"), w("australsk"),
      "オーストラリア", "豪州", "호주", "ออสเตรเลีย",
    ]),
  },
  {
    label: "Canadian",
    pattern: rx([
      w("canadian"), ww("canada"), w("canadien"), w("kanadisch"), ww("kanadier"), w("canades[ei]"), w("canadiense"),
      w("canadense"), w("canadees"), w("kanadyjsk"), w("kanadsk"), w("kanadai"), "канад", "καναδ", w("kanadal"),
      "カナダ", "캐나다",
    ]),
  },
  {
    label: "Singaporean",
    pattern: rx([w("singapor"), w("singapur"), w("szingapúr"), "сингапур", "シンガポール", "싱가포르", "新加坡"]),
  },
  {
    label: "Malaysian",
    pattern: rx([w("malaysia"), w("malaisie"), w("malesi"), w("malasia"), w("malezj"), "малайз", "マレーシア", "말레이시아", "马来西亚"]),
  },
  {
    label: "Middle Eastern",
    pattern: rx([
      "middle east", w("arab"), ww("gulf (clients|guests|tourists|states)"), ww("gcc"), w("emirati"), ww("uae"), ww("dubai"),
      w("saudi"), w("qatari"), w("kuwaiti"), "moyen-orient", "naher osten", w("arabisch"), "medio oriente", "oriente medio",
      w("árabe"), w("arabo"), "midden-oosten", "bliski wschód", "ближний восток", "μέση ανατολή", "orta doğu",
      "中東", "アラブ", "중동", "아랍", "الخليج", "عرب",
    ]),
  },
  {
    label: "Japanese",
    pattern: rx([
      w("japanese"), ww("japan"), w("japonais"), w("japanisch"), ww("japaner"), w("giappones"), w("japon[eé]s"),
      w("japans"), w("japońsk"), w("japonsk"), w("japán"), "япон", "ιαπων", ww("japon"), w("japansk"), w("japanilai"),
      "日本人", "日本の", "日本から", "日本", "일본", "ญี่ปุ่น", "nhật bản",
    ]),
    exclude: /japanese (food|cuisine|restaurant|garden|language)|in japan(?!ese)|japan tour|japan guide|guide in japan/iu,
  },
  {
    label: "Korean",
    pattern: rx([
      w("korean"), ww("korea"), w("cor[eé]en"), w("koreanisch"), ww("koreaner"), w("corean"), w("koreaans"),
      w("koreańsk"), w("korejsk"), w("koreai"), "корей", "κορεατ", w("kore"), w("koreansk"), w("korealai"),
      "韓国", "韓國", "한국인", "한국", "เกาหลี", "hàn quốc",
    ]),
    exclude: /korean (food|cuisine|restaurant|bbq|language)|in korea(?!n)|korea tour|guide in korea/iu,
  },
  {
    label: "European",
    pattern: rx([
      w("european"), w("europ[eé]en"), w("europ[aä]isch"), w("europe[oaie]"), w("europees"), w("europejsk"),
      w("evropsk"), w("európai"), "европей", "ευρωπα", w("avrupalı"), w("europeisk"), w("eurooppalai"),
      "ヨーロッパ", "欧州", "유럽",
    ]),
  },
  {
    label: "International",
    pattern: rx([
      w("international"), w("internacional"), w("internazional"), w("internation"), "from all over the world",
      "from around the world", w("worldwide"), "all nationalities", "aus aller welt", "du monde entier",
      "de todo el mundo", "da tutto il mondo", "de todo o mundo", "van over de hele wereld", "z całego świata",
      "z celého světa", "a világ minden", "din toată lumea", "со всего мира", "από όλο τον κόσμο", "dünyanın her yerinden",
      "iz cijelog svijeta", "från hela världen", "ympäri maailmaa", "世界中", "海外から", "外国人", "訪日", "インバウンド",
      "전 세계", "외국인", "국제",
    ]),
  },
];

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

export const VEHICLE_RULES: KeywordRule<VehicleType>[] = [
  {
    label: "Coach",
    pattern: rx([
      ww("coach(es)?"), ww("motor ?coach"), ww("tour bus"), ww("full[- ]size bus"), ww("big bus"), ww("large bus"),
      ww("reisebus(se)?"), ww("autocar"), ww("autobus"), ww("pullman"), ww("autocarro"), ww("touringcar"),
      ww("autokar"), ww("zájezdový autobus"), ww("autóbusz"), ww("autocar"), "автобус", "λεωφορείο", ww("otobüs"),
      ww("turistički autobus"), ww("turistbuss"), ww("linja-auto"), "大型バス", "観光バス", "大型버스", "대형버스", "관광버스",
      // seat counts >= 25 imply a coach
      "(?:2[5-9]|[3-6]\\d)[ -]?(?:seater|seats|pax|passengers|places|posti|plazas|sitzer|plätze|personen|人乗り|인승)",
    ]),
    exclude: /bus stop|by bus|public bus|local bus|bus station|bus ticket|no bus|shuttle bus|hop[- ]on|city bus|autobus (publico|urbano|de línea)|mit dem bus|en bus|in autobus|del autobús|coach(ing)? (session|program)|life coach|business coach/iu,
  },
  {
    label: "Minibus",
    pattern: rx([
      ww("mini[- ]?bus(es|se|ses)?"), ww("micro[- ]?bus"), ww("kleinbus(se)?"), ww("minibús"), ww("minibüs"),
      ww("minibusz"), ww("mikrobus"), ww("mikroautobus"), ww("minibuss"), ww("pikkubussi"), "микроавтобус",
      "мікроавтобус", "μίνι μπας", "μινι μπας", "マイクロバス", "ミニバス", "미니버스", "소형버스",
      ww("sprinter"), ww("mercedes[- ]sprinter"), ww("crafter"), ww("ford transit"), ww("iveco daily"), ww("toyota coaster"),
      ww("hyundai county"), ww("solati"),
      // 9–24 seats
      "(?:9|1\\d|2[0-4])[ -]?(?:seater|seats|pax|passengers|places|posti|plazas|sitzer|plätze|personen|人乗り|인승)",
      "(?:up to|bis zu|jusqu'à|fino a|hasta|até) (?:9|1\\d|2[0-4]) (?:people|persons|passengers|personen|personnes|persone|personas|pessoas)",
    ]),
  },
  {
    label: "Minivan",
    pattern: rx([
      ww("mini[- ]?vans?"), ww("passenger van"), ww("people carrier"), ww("mpv"), ww("monovolume"), ww("monovolumen"),
      ww("monospace"), ww("furgoneta"), ww("kleinbus"), ww("van (tour|service|rental|hire)"), ww("luxury van"), ww("private van"),
      ww("busje"), ww("minibusje"), ww("wagon"), "ミニバン", "ワゴン", "ワンボックス", "ハイエース", "アルファード", "ヴェルファイア",
      "エルグランド", "ノア", "ヴォクシー", "セレナ", "미니밴", "밴 ", "카니발", "스타렉스", "스타리아",
      ww("v[- ]?class"), ww("v[- ]?klasse"), ww("classe v"), ww("clase v"), ww("vito"), ww("viano"), ww("alphard"),
      ww("vellfire"), ww("hiace"), ww("sienna"), ww("odyssey"), ww("caravelle"), ww("multivan"), ww("transporter"),
      ww("carnival"), ww("starex"), ww("staria"), ww("grand starex"), ww("noah"), ww("voxy"), ww("serena"), ww("elgrand"),
      ww("granvia"), ww("tourneo"), ww("sharan"), ww("zafira"), ww("touran"), ww("traveller"), ww("spacetourer"),
      ww("proace"), ww("vivaro"), ww("trafic"), ww("expert"), ww("jumpy"), ww("evalia"), ww("nv200"), ww("nv350"), ww("marco polo"),
      // 6–8 seats
      "(?:[6-8])[ -]?(?:seater|seats|pax|passengers|places|posti|plazas|sitzer|plätze|personen|人乗り|인승)",
      "(?:up to|bis zu|jusqu'à|fino a|hasta|até) [6-8] (?:people|persons|passengers|personen|personnes|persone|personas|pessoas)",
    ]),
    exclude: /caravan|campervan|camper van|van gogh|van der|van de|van den|van het|van een|advantage|relevant/iu,
  },
  {
    label: "SUV",
    pattern: rx([
      ww("suvs?"), ww("4x4"), ww("4wd"), ww("awd"), ww("jeep"), ww("land ?cruiser"), ww("range rover"), ww("land rover"),
      ww("discovery"), ww("x5"), ww("x7"), ww("q7"), ww("q8"), ww("gle"), ww("gls"), ww("xc90"), ww("cayenne"), ww("touareg"),
      ww("prado"), ww("pajero"), ww("fortuner"), ww("highlander"), ww("palisade"), ww("santa fe"), ww("sorento"), ww("gelände\\p{L}*"),
      ww("todoterreno"), ww("fuoristrada"), ww("tout-terrain"), "внедорожник", "джип", "SUV車", "四駆", "SUV",
    ]),
  },
  {
    label: "Sedan",
    pattern: rx([
      ww("sedans?"), ww("saloon"), ww("berline"), ww("berlina"), ww("limousinen?"), ww("limousine service"), ww("limusina"),
      ww("limuzyna"), ww("limuzína"), ww("limuzin"), "седан", ww("sedán"), "セダン", "세단", ww("executive car"), ww("luxury car"),
      ww("premium car"), ww("private car"), ww("chauffeur[- ]driven car"), ww("town car"), ww("black car"),
      ww("e[- ]?class"), ww("e[- ]?klasse"), ww("classe e"), ww("clase e"), ww("s[- ]?class"), ww("s[- ]?klasse"), ww("classe s"),
      ww("bmw [57]\\p{L}*"), ww("audi a[68]"), ww("tesla"), ww("model [sy3x]"), ww("camry"), ww("crown"), ww("lexus"), ww("genesis"),
      ww("grandeur"), ww("k9"), ww("skoda superb"), ww("superb"), ww("passat"), ww("mercedes[- ]benz"), ww("mercedes"),
      ww("car (tour|service|hire|rental|with driver)s?"), ww("(own|my|private) (car|vehicle)"), ww("comfortable car"),
      ww("mit (eigenem|meinem) (auto|pkw|wagen)"), ww("eigenes auto"), ww("pkw"), ww("en voiture"), ww("ma voiture"), ww("voiture priv[eé]e"),
      ww("in macchina"), ww("mia auto"), ww("auto privata"), ww("en coche"), ww("mi coche"), ww("coche privado"), ww("coche particular"),
      ww("meu carro"), ww("carro particular"), ww("eigen auto"), ww("własnym samochodem"), ww("samochodem"), ww("vlastním autem"),
      ww("saját autó\\p{L}*"), ww("mașina proprie"), "на (своем|своём|собственном) (авто|автомобиле)", "автомобиль", "με αυτοκίνητο",
      ww("özel araç"), ww("araçla"), ww("vlastitim automobilom"), ww("egen bil"), ww("omalla autolla"), "乗用車", "自家用車", "車で",
      "マイカー", "ハイヤー", "승용차", "차량", "자가용",
    ]),
    exclude: /rental car (recommend|tips)|car park|parking|by car from|hire a car yourself|no car|without (a )?car|sans voiture|ohne auto|senza auto|sin coche/iu,
  },
  {
    label: "Motorcycle",
    pattern: rx([ww("motorcycles?"), ww("motorbikes?"), ww("vespa"), ww("scooters?"), ww("motos?"), ww("motorrad"), ww("motocicleta"), "バイク", "オートバイ", "오토바이"]),
    exclude: /no motorbike|scooter rental tips/iu,
  },
  {
    label: "None",
    pattern: rx([
      "walking tours? only", "on foot only", "no vehicle", "do not (provide|offer) (a )?(car|vehicle|transport)", "public transport only",
      "uniquement à pied", "nur zu fuß", "solo a piedi", "solo a pie", "apenas a pé", "alleen te voet", "tylko pieszo",
      "pouze pěšky", "csak gyalog", "doar pe jos", "только пешком", "μόνο με τα πόδια", "sadece yürüyerek", "徒歩のみ", "도보로만",
      "walking guide", "walking tour guide", "stadtführung(en)? zu fuß", "visite à pied",
    ]),
  },
];

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

export const SERVICE_RULES: KeywordRule<ServiceType>[] = [
  {
    label: "Driver-Guide",
    pattern: rx([
      ww("driver[- /]?guides?"), ww("driving guides?"), ww("guide[- /]?drivers?"), ww("chauffeur[- ]guides?"), ww("guide[- ]chauffeurs?"),
      ww("guide[- ]conducteur"), ww("chauffeur[- ]accompagnateur"), ww("fahrer[- ]?(und|&|\\/)?[- ]?(reiseleiter|guide|stadtführer)"),
      ww("reiseleiter[- ]?(und|&|\\/)?[- ]?fahrer"), ww("fahrer-guide"), ww("autista[- ]?guida"), ww("guida[- ]?autista"),
      ww("guida[- ]?(e|ed|/) autista"), ww("conductor[- ]?gu[ií]a"), ww("gu[ií]a[- ]?(y |/)?conductor"), ww("chofer[- ]?gu[ií]a"),
      ww("gu[ií]a[- ]?chofer"), ww("motorista[- ]?guia"), ww("guia[- ]?motorista"), ww("chauffeur[- ]?gids"), ww("gids[- ]?chauffeur"),
      ww("kierowca[- ]?przewodnik"), ww("przewodnik[- ]?kierowca"), ww("řidič[- ]?(a |/)?průvodce"), ww("průvodce[- ]?(a |/)?řidič"),
      ww("sofőr[- ]?idegenvezető"), ww("idegenvezető[- ]?sofőr"), ww("șofer[- ]?ghid"), ww("ghid[- ]?șofer"), "гид[- ]?водитель",
      "водитель[- ]?гид", "шофьор[- ]?екскурзовод", "οδηγός[- ]?ξεναγός", ww("şoför[- ]?rehber"), ww("rehber[- ]?şoför"),
      ww("vozač[- ]?vodič"), ww("vodič[- ]?vozač"), ww("chaufför[- ]?guide"), ww("guide[- ]?chaufför"), ww("kuljettaja[- ]?opas"),
      "ドライバーガイド", "運転手兼ガイド", "ガイド兼ドライバー", "ガイド兼運転手", "運転.{0,6}ガイド", "ガイド.{0,6}運転", "기사 ?겸 ?가이드",
      "가이드 ?겸 ?기사", "드라이빙 ?가이드", "운전 ?가이드", "가이드 ?운전",
      // phrases: "I drive and guide", "I will drive you"
      "i (will )?(drive|pick you up) (and|&) guide", "guide (and|&) drive", "drive (and|&) guide", "ich fahre (sie|euch)",
      "je vous conduis", "vi porto io", "os llevo en mi", "運転もガイドも", "제가 직접 운전",
    ]),
  },
  {
    label: "Tour Manager",
    pattern: rx([
      ww("tour ?managers?"), ww("tour ?leaders?"), ww("tour ?directors?"), ww("tour ?escorts?"), ww("group leaders?"), ww("trip leaders?"),
      ww("tour conductor"), ww("accompagnateur(s|trice)?"), ww("accompagnat(ore|rice|ori)( turistic[oai])?"), ww("direttore tecnico"),
      ww("reiseleiter(in)?"), ww("reisebegleit\\p{L}*"), ww("gruppenreiseleit\\p{L}*"), ww("jefe de grupo"), ww("gu[ií]a acompañante"),
      ww("director de (tour|viaje|grupo)"), ww("gu[ií]a de grupo"), ww("guia acompanhante"), ww("chefe de grupo"), ww("reisleid(er|ster)"),
      ww("reisbegeleid\\p{L}*"), ww("pilot wycieczek"), ww("kierownik wycieczki"), ww("vedoucí zájezdu"), ww("delegát"), ww("csoportkísérő"),
      ww("idegenvezető csoport\\p{L}*"), ww("conducător de grup"), ww("însoțitor de grup"), "руководитель группы", "сопровождающий",
      "тур[- ]?лидер", "тур[- ]?менеджер", "водач на групи", ww("αρχηγός"), ww("συνοδός"), ww("tur lideri"), ww("tur yöneticisi"),
      ww("grup lideri"), ww("turistički pratitelj"), ww("vodja poti"), ww("reseledare"), ww("rejseleder"), ww("reiseleder"), ww("matkanjohtaja"),
      "ツアーコンダクター", "添乗員", "旅程管理", "ツアーリーダー", "スルーガイド", "투어 ?매니저", "인솔자", "투어 ?리더", "투어 ?컨덕터",
      "multi[- ]day tours?", "round trips?", "rundreise", "circuit", "itinerari[oe] (di )?più giorni", "viaje de varios días",
      "多日", "周遊", "다일정",
    ]),
  },
  {
    label: "Driver",
    pattern: rx([
      ww("drivers?"), ww("chauffeurs?"), ww("private driver"), ww("driving service"), ww("fahrer(in)?"), ww("chauffeurservice"),
      ww("autist[ai]"), ww("conductor(a|es)?"), ww("ch[oó]fer(es)?"), ww("motorista"), ww("bestuurder"), ww("kierowc[ay]"),
      ww("řidič"), ww("vodič"), ww("sofőr"), ww("șofer"), "шофьор", "водитель", "водій", "οδηγός", ww("şoför"), ww("sürücü"),
      ww("vozač"), ww("voznik"), ww("chaufför"), ww("sjåfør"), ww("chauffør"), ww("kuljettaja"), ww("autojuht"), ww("vadītājs"),
      ww("vairuotojas"), ww("shofer"), "მძღოლ", "ドライバー", "運転手", "運転", "送迎", "기사", "운전", "드라이버", "픽업",
      "คนขับ", "tài xế", "lái xe", ww("sopir"), ww("supir"), "سائق",
    ]),
    exclude: /taxi driver (recommendation|strike)|bus driver|screwdriver|driver's license only|licence de conduire/iu,
  },
  {
    label: "Guide",
    pattern: rx([
      ww("guides?"), ww("tour ?guides?"), ww("local guides?"), ww("reisef[uü]hrer(in)?"), ww("fremdenf[uü]hrer(in)?"), ww("stadtf[uü]hrer(in)?"),
      ww("g[aä]stef[uü]hrer(in)?"), ww("reiseleiter(in)?"), ww("guide[- ]conf[eé]rencier"), ww("guida( turistica)?"), ww("gu[ií]a( tur[ií]stic[oa])?"),
      ww("guia( tur[ií]stic[oa])?"), ww("gids"), ww("przewodnik"), ww("průvodce"), ww("sprievodca"), ww("idegenvezető"), ww("ghid"),
      "екскурзовод", ww("гид"), "экскурсовод", "екскурсовод", ww("ξεναγός"), ww("rehber"), ww("turistički vodič"), ww("vodnik"),
      ww("vodič"), ww("guide"), ww("opas"), ww("matkaopas"), ww("giid"), ww("gids"), ww("gidas"), ww("udhërrëfyes"), "გიდ",
      "ガイド", "通訳案内士", "案内", "가이드", "관광통역안내사", "안내사", "ไกด์", "มัคคุเทศก์", "hướng dẫn viên", ww("pemandu"), "مرشد",
    ]),
    exclude: /travel guide (book|blog|article)|guidebook|guide to|guía de viaje|guide du routard|reiseführer (kaufen|buch)|user guide|style guide/iu,
  },
  {
    label: "Transfer",
    pattern: rx([
      ww("transfers?"), ww("airport (pick[- ]?up|transfer|shuttle)"), ww("transferts?"), ww("traslados?"), ww("trasferiment[oi]"),
      ww("transfery"), ww("трансфер"), "μεταφορ", ww("havalimanı transfer"), "送迎", "空港送迎", "픽업", "공항 ?픽업", "รับส่ง", "đưa đón",
    ]),
    exclude: /bank transfer|wire transfer|money transfer|transfer fee|virement|überweisung|bonifico|transferencia bancaria/iu,
  },
  {
    label: "Interpreter",
    pattern: rx([
      ww("interpreters?"), ww("interpr[eè]te"), ww("dolmetscher(in)?"), ww("interprete"), ww("int[eé]rprete"), ww("tolk"), ww("tłumacz"),
      ww("tlumočník"), ww("tolmács"), ww("interpret"), "переводчик", "διερμηνέας", ww("tercüman"), ww("prevoditelj"), ww("tulkki"), "通訳", "통역",
    ]),
  },
];

// ---------------------------------------------------------------------------------------------
// Misc traits
// ---------------------------------------------------------------------------------------------

export const COUPLES_PATTERN = rx([
  ww("couples?"), ww("honeymoon(ers)?"), ww("paare?"), ww("p[aä]rchen"), ww("hochzeitsreise"), ww("couples?"), ww("lune de miel"),
  ww("coppi[ae]"), ww("viaggio di nozze"), ww("parejas?"), ww("luna de miel"), ww("casais"), ww("koppels"), ww("huwelijksreis"),
  ww("pary"), ww("páry"), ww("párok"), ww("cupluri"), "пары", "молодожен", "ζευγάρια", ww("çiftler"), ww("parovi"), ww("par"),
  ww("smekmånad"), "カップル", "夫婦", "ご夫婦", "ハネムーン", "新婚旅行", "커플", "부부", "신혼", "2 (people|persons|pax|guests)",
  "two (people|persons|travellers|travelers)",
]);

export const SMALL_GROUP_PATTERN = rx([
  "small[- ]groups?", "private (tours?|groups?)", "famil(y|ies)", "kleine gruppen?", "kleingruppen?", "privatgruppen?", "familien",
  "petits? groupes?", "familles?", "piccoli gruppi", "famiglie", "grupos? pequeños?", "familias", "pequenos grupos", "famílias",
  "kleine groepen", "gezinnen", "małe grupy", "rodziny", "malé skupiny", "rodiny", "kis csoport", "családok", "grupuri mici", "familii",
  "небольшие группы", "малые группы", "семьи", "малки групи", "семейства", "μικρές ομάδες", "οικογένειες", "küçük gruplar", "aileler",
  "male grupe", "obitelji", "små grupper", "familjer", "pienryhm", "perheet", "少人数", "小グループ", "プライベート", "ファミリー", "家族",
  "소그룹", "소규모", "가족", "프라이빗", "up to (4|5|6|7|8) (people|persons|guests|pax)", "max(imum)? (4|5|6|7|8) (people|persons|guests|pax)",
]);

export const INDEPENDENT_PATTERN = rx([
  ww("independent"), ww("freelancer?"), ww("self[- ]employed"), ww("owner[- ]operat\\p{L}*"), ww("selbst[aä]ndig(e|er)?"), ww("freiberuflich"),
  ww("ind[eé]pendant(e)?"), ww("indipendente"), ww("libero professionista"), ww("aut[oó]nom[oa]"), ww("independiente"), ww("zelfstandig"),
  ww("niezależn\\p{L}*"), ww("nezávisl\\p{L}*"), ww("osvč"), ww("független"), ww("independent"), "независим", "самозанят", "частный гид",
  "ανεξάρτητ", ww("bağımsız"), ww("neovisn\\p{L}*"), ww("samostojn\\p{L}*"), ww("egen företag\\p{L}*"), ww("frilans"), ww("itsenäi\\p{L}*"),
  "フリーランス", "個人ガイド", "個人で", "プライベートガイド", "프리랜서", "개인 ?가이드", "1인",
]);

export const COMPANY_PATTERN = rx([
  "our (team|drivers|guides|fleet|staff)", "we (are|have) (a|an) (company|agency|team|fleet)", "fleet of", "team of \\d+",
  "unsere (fahrer|guides|flotte|mitarbeiter)", "notre (équipe|flotte)", "nos (chauffeurs|guides)", "la nostra (flotta|squadra)", "i nostri (autisti|guide)",
  "nuestra flota", "nuestros (conductores|guías)", "nossa (frota|equipe)", "ons team", "onze (chauffeurs|gidsen)", "nasza flota", "naši (řidiči|průvodci)",
  "наш(а|и) (команда|водители|гиды|автопарк)", "η ομάδα μας", "ekibimiz", "filomuz", "弊社", "当社", "私たちのチーム", "スタッフ", "저희 (팀|회사)",
  "\\b(ltd|llc|gmbh|s\\.?r\\.?l\\.?|s\\.?l\\.?|sas|sarl|bv|ab|as|oy|sp\\. z o\\.o\\.|kft|srl|d\\.o\\.o\\.|株式会社|有限会社|\\(주\\)|주식회사)\\b",
]);

export const LICENSED_PATTERN = rx([
  ww("licen[sc]ed"), ww("licen[sc]e"), ww("certified"), ww("official guide"), ww("lizenziert\\p{L}*"), ww("staatlich geprüft\\p{L}*"),
  ww("zertifiziert\\p{L}*"), ww("agréé\\p{L}*"), ww("carte professionnelle"), ww("guide[- ]conférenci\\p{L}*"), ww("diplômé\\p{L}*"),
  ww("abilitat[oa]"), ww("patentino"), ww("autorizzat[oa]"), ww("habilitad[oa]"), ww("oficial"), ww("carnet"), ww("credenciad[oa]"),
  ww("gecertificeerd"), ww("erkend"), ww("licencjonowan\\p{L}*"), ww("uprawnieni\\p{L}*"), ww("licencovan\\p{L}*"), ww("engedél\\p{L}*"),
  ww("atestat"), ww("autorizat"), "лицензи", "сертифицир", "αδειούχ", "διπλωματούχ", ww("lisanslı"), ww("kokartlı"), ww("licenciran\\p{L}*"),
  ww("auktoriserad"), ww("autorisert"), ww("autoriseret"), ww("auktorisoitu"), "通訳案内士", "国家資格", "資格", "認定", "관광통역안내사", "자격증", "공인",
]);

export const WHATSAPP_PATTERN = /whats\s?app|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|ワッツアップ|왓츠앱|ватсап|вотсап|واتساب|whatsap\b|\bWA\s*[:+]/iu;

export const EXPERIENCE_YEARS_PATTERN =
  /(\d{1,2})\s*\+?\s*(?:years?|yrs?|jahren?|ans|années|anni|años|anos|jaar|lat|let|év|ani|лет|года?|χρόνια|yıl|godina|år|vuotta|年|년)(?:[^.\n]{0,40}?)(?:experience|exp\b|erfahrung|expérience|esperienza|experiencia|experiência|ervaring|doświadczeni|zkušenost|tapasztalat|experiență|опыт|стаж|εμπειρία|deneyim|iskustv|erfarenhet|kokemus|経験|経歴|キャリア|경력|경험)/iu;
export const EXPERIENCE_YEARS_PATTERN_REVERSED =
  /(?:experience|erfahrung|expérience|esperienza|experiencia|experiência|ervaring|doświadczenie|zkušenosti|tapasztalat|experiență|опыт|стаж|εμπειρία|deneyim|iskustvo|erfarenhet|kokemus|経験|경력|경험)[^.\n]{0,40}?(\d{1,2})\s*\+?\s*(?:years?|yrs?|jahren?|ans|années|anni|años|anos|jaar|lat|let|év|ani|лет|года?|χρόνια|yıl|godina|år|vuotta|年|년)/iu;
export const SINCE_YEAR_PATTERN = /(?:since|seit|depuis|dal|desde|sinds|od|från|siden|vuodesta|с|από|den beri|創業|から|부터)\s*((?:19|20)\d{2})/iu;

export const CAPACITY_PATTERN =
  /(?:up to|max(?:imum)?\.?|bis( zu)?|jusqu'à|fino a|hasta|até|tot|do|maks\.?|максимум|до|έως|en fazla|最大|최대)?\s*(\d{1,2})\s*(?:-|–|to|bis|à|a|~)?\s*(\d{1,2})?\s*[- ]?(?:seater|seats?|pax|passengers?|persons?|people|guests|travell?ers|sitzer|sitzplätze|plätze|personen|places|passagers|personnes|posti|passeggeri|persone|plazas|pasajeros|personas|lugares|passageiros|pessoas|zitplaatsen|personen|miejsc|osób|pasażerów|míst|osob|fő|személy|locuri|persoane|мест|человек|пассажир\p{L}*|θέσεις|άτομα|kişilik|kişi|yolcu|sjedišta|sedežev|putnika|platser|personer|paikkaa|henkilöä|人乗り|名様?|人|인승|명)/giu;
