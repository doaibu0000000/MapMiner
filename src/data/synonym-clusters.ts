/** Kamus klaster sinonim MapMiner — v2 (diperluas dari 40 → ~95 klaster).
 *
 *  SEMUA istilah dalam satu klaster saling menjadi sinonim; setiap istilah adalah
 *  pencarian Google Maps tersendiri yang mengindeks himpunan tempat berbeda.
 *  Istilah diambil dari penamaan nyata tempat usaha di Google Maps Indonesia
 *  (termasuk variasi ejaan/singkatan/istilah daerah) agar satu kategori di satu
 *  kota/kabupaten tidak terlewat satu tempat pun.
 *
 *  Catatan: batas lama 16 istilah per klaster sudah tidak ada — engine batch
 *  menerima kata kunci sebanyak apa pun (NoKeywordLimit). Klaster boleh panjang.
 */
export const SYNONYM_CLUSTERS: string[][] = [
  // --- Rambut & Kecantikan ---
  ["barbershop", "babershop", "barber shop", "barber", "barbershop pria", "pangkas rambut", "tempat pangkas rambut", "potong rambut", "cukur rambut", "cukur pria", "tempat cukur", "salon pria", "salon rambut", "rambut pria", "pangkas pria", "potong rambut pria", "barbershop anak", "pangkas rambut anak", "kapster"],
  ["salon", "salon kecantikan", "salon wanita", "salon bridal", "salon rias", "salon terdekat", "salon rambut wanita", "creambath", "smoothing", "keratin", "hair salon", "hair treatment", "tata rias", "rias pengantin", "makeup artist", "mua"],
  ["klinik kecantikan", "klinik kecantikan terdekat", "skincare", "skin care", "facial", "beauty care", "beauty clinic", "aesthetic clinic", "klinik estetika", "hydrafacial", "perawatan kulit", "facial spa"],
  ["nail art", "salon kuku", "manicure", "pedicure", "extension kuku", "sulam alis", "embroidery alis", "eyelash extension", "salon bulu mata", "lashes", "salon alis"],

  // --- Kopi & Kuliner ---
  ["kafe", "cafe", "coffee shop", "kedai kopi", "warkop", "warung kopi", "kopi", "coffee", "coffeehouse", "toko kopi", "specialty coffee", "roastery", "coffee roastery", "kafe instagramable", "cafe resto", "coffeeshop"],
  ["restoran", "resto", "rumah makan", "warung makan", "warung", "kedai makan", "kedai", "kantin", "warteg", "warung tegal", "rumah makan sunda", "restoran keluarga", "rumah makan keluarga"],
  ["rumah makan padang", "nasi padang", "masakan padang", "resto padang", "padang", "warung padang", "masakan minang"],
  ["bakso", "bakso solo", "bakso urat", "bakso campur", "mie ayam", "mie bakso", "mie pangsit", "bakmi", "mie yamin", "warung bakso", "bakwan malang"],
  ["nasi goreng", "mie goreng", "kwetiau", "bihun goreng", "nasi campur", "nasi goreng spesial", "kuetiau", "kwetiau goreng"],
  ["ayam geprek", "geprek", "ayam penyet", "ayam goreng", "ayam bakar", "resto ayam", "warung ayam", "ayam crispy", "fried chicken", "ayam bakar madu", "ayam katsu", "katsu", "penyetan", "warung penyetan"],
  ["seafood", "sea food", "ikan bakar", "restoran seafood", "seafood kiloan", "warung seafood", "kepiting", "cumi", "udang", "ikan goreng", "gurame", "gurame bakar"],
  ["sate", "sate ayam", "sate kambing", "sate padang", "sate maranggi", "warung sate", "sate kelinci"],
  ["katering", "catering", "jasa katering", "jasa catering", "nasi box", "snack box", "katering harian", "masakan rumahan beku"],
  ["bakery", "toko roti", "roti", "toko kue", "kue", "cake shop", "cake", "kue basah", "kue kering", "kue ulang tahun", "pastry", "donat", "roti bakar", "brownies", "brownies kukus", "bolu", "bolu kukus", "tart", "tart ulang tahun", "hampers", "hampers kue"],
  ["soto", "soto ayam", "soto babat", "soto bandung", "rawon", "sop", "sop iga", "sop buntut", "sup kambing", "gulai", "sengkel", "warung soto"],
  ["pecel lele", "lele", "warung pecel lele", "lele bakar", "lele goreng", "mendoan", "tempe mendoan", "tahu sumedang", "kupat tahu"],
  ["mie aceh", "mie kocok", "mie tot", "mie jawa", "bakmi jawa", "mie ongklok", "mie gomak"],
  ["sushi", "ramen", "resto jepang", "restoran jepang", "japanese food", "sushi bar", "donburi", "takoyaki"],
  ["korean bbq", "resto korea", "korean food", "kimbap", "tteokbokki", "korean fried chicken", "restoran korea"],
  ["resto china", "chinese food", "restoran china", "rumah makan china", "dimsum", "dim sum", "capcay", "bakpao"],
  ["pizza", "burger", "hotdog", "kebab", "sandwich", "sosis", "corn dog", "french fries"],
  ["martabak", "martabak manis", "terang bulan", "martabak telur", "martabak mini", "wafel", "waffle", "pancake", "piscok", "pisang goreng", "cimol", "cilok", "batagor", "siomay"],
  ["es krim", "ice cream", "gelato", "boba", "bubble drink", "minuman", "es teh", "es jeruk", "jus", "juice", "smoothie", "wedang", "es campur", "es doger", "es teler", "es puter", "toko jus"],
  ["gudeg", "warung jogja", "gudeg jogja", "ketoprak", "gado gado", "karedok", "lotek", "nasi uduk", "nasi kuning", "nasi rames", "nasi langgi", "nasi pecel", "pecel", "pecel madiun"],
  ["gorengan", "warung gorengan", "tahu goreng", "tempe goreng", "bakwan", "combro", "gehu", "makanan murah", "warung anak kos"],
  ["frozen food", "makanan beku", "sambal", "abon", "rendang", "rendang kemasan", "olahan daging kemasan"],

  // --- Cuci & Perawatan ---
  ["laundry", "londry", "londrei", "binatu", "cuci kilat", "laundry kiloan", "cuci kering", "jasa cuci", "self service laundry", "laundry satuan", "laundry express", "express laundry", "cuci pakaian", "setrika", "cuci setrika", "cuci bed cover", "cuci selimut", "cuci jaket", "laundry hotel"],
  ["cuci sepatu", "laundry sepatu", "shoe clean", "shoe care", "cleaning sepatu", "cuci tas", "cuci helm"],
  ["cuci mobil", "car wash", "carwash", "cuci steam", "salon mobil", "detailing", "cuci motor", "cuci motor salju", "steam motor", "detailing mobil", "coating mobil", "cuci hem motor"],
  ["laundry karpet", "cuci karpet", "cuci sofa", "cuci spring bed", "cuci kasur", "cuci gorden", "cuci stroller"],

  // --- Fashion & Pakaian ---
  ["distro", "toko distro", "baju distro", "kaos distro", "toko kaos", "clothing", "butik", "fashion", "toko baju", "toko pakaian", "galeri distro", "outlet distro", "distro clothing", "toko fashion", "pakaian", "toko celana", "kaos", "t-shirt", "hoodie", "jaket", "toko jaket"],
  ["toko sepatu", "sepatu", "toko sandal", "sepatu sandal", "sneakers", "shoe store", "sepatu pria", "sepatu wanita", "sepatu anak", "toko sneakers", "sepatu olahraga", "sneakers store"],
  ["tas", "toko tas", "toko tas dan koper", "tas gendong", "tas ransel", "tas selempang", "tas jinjing", "tas trolley", "tas koper", "koper", "toko koper", "koper dan tas", "tas wanita", "tas pria", "tas kulit", "tas sekolah", "tas laptop", "tas travel", "tas murah", "tas import", "tas branded", "grosir tas", "tas punggung", "toko bag"],
  ["toko jilbab", "toko hijab", "hijab", "jilbab", "busana muslim", "toko muslim", "gamis", "toko gamis", "hijab store", "toko koko", "koko", "baju koko", "sarung", "peci", "kerudung"],
  ["konveksi", "konveksi kaos", "tukang jahit", "penjahit", "jasa jahit", "jahit baju", "tailor", "vermak", "vermak levis", "jahit jas", "sablon", "sablon kaos", "bordir", "konveksi seragam", "jahit seragam"],
  ["batik", "toko batik", "batik tulis", "batik cap", "pusat batik", "batik jawa", "seragam batik", "tenun", "ulos"],
  ["toko bayi", "baby shop", "perlengkapan bayi", "baju bayi", "stroller", "perlengkapan anak", "toko perlengkapan bayi", "mpasi", "perlengkapan bayi murah"],
  ["grosir baju", "grosir pakaian", "pusat grosir", "toko grosir", "grosir", "grosir murah", "grosir kaos"],

  // --- Otomotif ---
  ["bengkel", "bengkel motor", "bengkel mobil", "servis motor", "servis mobil", "jasa servis", "montir", "tune up motor", "tune up mobil", "ganti oli", "ganti oli motor", "ganti oli mobil", "bengkel panggilan", "servis besar", "servis ringan"],
  ["tambal ban", "tambal ban tubeless", "bengkel ban", "toko ban", "ban motor", "ban mobil", "vulkanisir", "toko ban mobil"],
  ["variasi motor", "aksesoris motor", "sparepart motor", "variasi mobil", "aksesoris mobil", "sparepart mobil", "audio mobil", "kaca film", "toko aksesoris", "kaca film mobil", "sparepart"],
  ["ac mobil", "servis ac mobil", "bengkel ac mobil", "bengkel ac", "isi freon", "cuci ac mobil", "isi freon mobil"],
  ["rental mobil", "sewa mobil", "car rental", "rental motor", "sewa motor", "rental elf", "rental hiace", "rental mobil lepas kunci", "sewa mobil lepas kunci", "rental lepas kunci"],
  ["dealer motor", "showroom motor", "dealer mobil", "showroom mobil", "mobil bekas", "motor bekas", "jual beli mobil", "jual beli motor"],
  ["toko sepeda", "sepeda", "sepeda listrik", "sepeda anak", "servis sepeda", "sepeda lipat", "sepeda gunung"],
  ["spbu", "pom bensin", "pom minyak", "agen lpg", "gas lpg", "pangkalan lpg", "agen gas", "gas 3kg", "agen solar", "depot solar"],

  // --- Kesehatan & Medis ---
  ["apotek", "apotik", "toko obat", "farmasi", "pharmacy", "obat herbal", "jamu", "toko jamu", "herbal", "apotek 24 jam", "gudang obat"],
  ["klinik", "klinik pratama", "klinik umum", "klinik keluarga", "dokter", "dokter umum", "praktek dokter", "praktik dokter", "puskesmas", "klinik 24 jam", "klinik anak"],
  ["klinik gigi", "dokter gigi", "dental care", "dentist", "praktek dokter gigi", "praktik dokter gigi", "klinik dokter gigi", "spesialis gigi", "dokter gigi anak", "klinik gigi anak"],
  ["dokter hewan", "klinik hewan", "pet shop", "petshop", "toko hewan", "groomer", "pet grooming", "vet", "kandang kucing", "pet care"],
  ["optik", "optik kacamata", "toko kacamata", "kacamata", "softlens", "optical", "toko softlens"],
  ["bidan", "praktek bidan", "praktik bidan", "klinik bidan", "klinik ibu dan anak", "konsultasi kehamilan", "dokter kandungan", "spesialis kandungan", "spog"],
  ["laboratorium", "lab klinik", "laboratorium klinik", "cek darah", "medical checkup", "pemeriksaan lab", "lab kespro"],
  ["fisioterapi", "fisio", "terapi", "psikolog", "konseling", "hipnoterapi", "terapi wicara", "terapi okupasi"],

  // --- Bangunan & Rumah ---
  ["toko bangunan", "material bangunan", "toko material", "material", "toko besi", "toko keramik", "bangunan", "toko kayu", "toko bangunan murah", "material murah", "toko baja"],
  ["toko cat", "cat", "cat tembok", "oplos cat", "cat bangunan", "toko cat murah"],
  ["toko listrik", "alat listrik", "material listrik", "toko lampu", "lampu", "kelistrikan", "listrik", "toko lampu hias"],
  ["toko mebel", "mebel", "furniture", "furnitur", "toko furniture", "mebel jepara", "interior", "toko sofa", "sofa", "toko kursi", "mebel custom", "furniture custom", "meubel", "kerajinan kayu"],
  ["bengkel las", "las", "tukang las", "teralis", "kanopi", "pagar besi", "pagar", "bengkel bubut", "bubut", "kanopi alderon"],
  ["atap", "genteng", "baja ringan", "seng", "spandek", "rangka atap", "atap upvc", "toko atap"],
  ["semen", "pasir", "bata", "batako", "hebel", "split", "cor", "batu alam", "kerikil", "material cor"],
  ["pipa", "pvc", "tandon air", "pompa air", "toko pipa", "plumbing", "water heater", "keran air", "toko plumbing"],
  ["toko perkakas", "perkakas", "alat tukang", "tool", "tools", "mesin potong", "gerinda", "bor", "alat ukur", "mesin tukang"],

  // --- Retail & Toko ---
  ["toko emas", "emas", "emas perhiasan", "toko perhiasan", "perhiasan", "gadai emas", "pembelian emas"],
  ["toko kelontong", "kelontong", "warung kelontong", "sembako", "toko sembako", "grosir sembako", "minimarket", "supermarket", "swalayan", "warung sembako", "hypermarket"],
  ["toko plastik", "kemasan plastik", "grosir plastik", "toko kemasan", "kemasan", "toko kemasan murah"],
  ["toko mainan", "mainan anak", "mainan", "grosir mainan", "mainan edukasi"],
  ["toko bunga", "florist", "bunga", "karangan bunga", "bunga potong", "flower shop", "toko tanaman", "toko tanaman hias", "tanaman hias", "garden shop"],
  ["fotokopi", "jasa fotokopi", "percetakan", "cetak undangan", "digital printing", "printing", "cetak spanduk", "cetak banner", "undangan", "cetak stiker", "stiker", "press id card", "cetak poster"],
  ["toko hp", "toko handphone", "hp", "servis hp", "servis handphone", "konter", "konter pulsa", "counter pulsa", "aksesoris hp", "aksesoris handphone", "ganti lcd", "toko pulsa", "bengkel hp", "flash hp"],
  ["toko laptop", "laptop", "servis laptop", "toko komputer", "komputer", "servis komputer", "printer", "servis printer", "aksesoris komputer", "toko printer"],
  ["toko elektronik", "elektronik", "servis elektronik", "service elektronik", "elektronik rumah tangga", "servis tv", "tv", "antena", "parabola", "kulkas", "mesin cuci", "servis kulkas", "servis mesin cuci", "service kulkas"],
  ["toko sayur", "sayur", "tukang sayur", "pasar sayur", "toko buah", "buah", "sayur mayur", "grosir sayur", "grosir buah", "sayur segar", "pasar buah"],
  ["toko ikan", "ikan hias", "akuarium", "aquarium", "pakan ikan", "toko akuarium", "ikan", "aksesoris akuarium", "bibit ikan"],
  ["toko burung", "burung", "burung kicau", "pakan burung", "kandang burung", "toko hewan kicau"],
  ["oleh oleh", "oleh-oleh", "souvernir", "souvenir", "pusat oleh oleh", "toko oleh oleh", "snack oleh oleh", "toko oleh"],

  // --- Jasa & Bisnis ---
  ["wedding organizer", "wo", "jasa wedding", "wedding", "paket pernikahan", "dekorasi pernikahan", "dekorasi wedding", "wedding decoration", "henna", "rias pengantin panggilan"],
  ["fotografer", "studio foto", "jasa foto", "photographer", "foto studio", "video shooting", "videografer", "cetak foto", "foto produk", "jasa foto produk", "studio foto keluarga"],
  ["notaris", "kantor notaris", "ppat", "notaris ppat", "jasa notaris", "kantor ppat"],
  ["bimbel", "bimbingan belajar", "les privat", "les", "kursus", "guru privat", "tutor", "bimbel cpns", "les cpns", "bimbel utbk", "kursus inggris", "les inggris", "kursus bahasa", "les matematika"],
  ["gym", "fitness", "fitness center", "pusat kebugaran", "kebugaran", "health club", "gym murah"],
  ["spa", "massage", "pijat", "pijat refleksi", "refleksi", "reflexology", "panti pijat", "urut", "massage therapy", "pijat panggilan", "spa murah", "pijat bayi", "pijat anak"],
  ["travel", "biro perjalanan", "agen travel", "tour travel", "agen tiket", "tiket", "travel antar kota", "shuttle", "travel shuttle"],
  ["umrah", "umroh", "travel umrah", "biro umrah", "haji plus", "paket umroh", "travel haji"],
  ["hotel", "penginapan", "guest house", "homestay", "losmen", "villa", "motel", "wisma", "hotel murah", "hotel melati", "penginapan murah", "guesthouse"],
  ["kost", "kos", "kosan", "kos kosan", "kos-kosan", "kos putri", "kos putra", "rumah kost", "kontrakan", "kost putri", "kost putra", "sewa kamar", "kontrakan rumah"],
  ["sekolah mengemudi", "kursus mengemudi", "les mengemudi", "driving school", "kursus sim", "kursus mobil"],
  ["cleaning service", "jasa kebersihan", "bersih rumah", "pest control", "anti rayap", "basmi rayap", "rayap", "fogging", "jasa bersih rumah"],
  ["tukang kunci", "ganti kunci", "kunci", "duplikat kunci", "servis kunci", "cctv", "pasang cctv", "servis cctv", "kamera cctv", "alarm", "gerbang otomatis", "pintu otomatis"],
  ["ac", "jual ac", "pasang ac", "bongkar pasang ac", "servis ac", "isi freon ac", "teknisi ac", "cuci ac", "toko ac"],
  ["jasa pindahan", "jasa angkut", "angkut barang", "mover", "sewa pick up", "sewa truk", "angkutan", "sewa engkel", "jasa angkut barang"],
  ["sewa tenda", "rental tenda", "sewa kursi", "sewa sound system", "sound system", "rental sound", "sewa kamera", "rental kamera", "sewa gaun", "sewa busana", "sewa jas", "sewa alat pesta", "perlengkapan pesta", "rental ps", "sewa playstation"],
  ["gedung pertemuan", "gedung serbaguna", "aula", "balai pertemuan", "tempat ulang tahun", "tempat ulang tahun anak", "event space", "gedung rapat", "balai sosial"],
  ["agen properti", "properti", "real estate", "developer", "perumahan", "sewa rumah", "jual tanah", "sewa ruko", "jual ruko", "agen sewa"],
  ["arsitek", "jasa arsitek", "desain rumah", "desain interior", "kontraktor", "jasa konstruksi", "tukang bangunan", "renovasi", "jasa renovasi", "tukang cat", "tukang pipa", "tukang taman", "jasa taman", "tukang listrik"],
  ["kursus musik", "alat musik", "toko alat musik", "studio musik", "studio rekaman", "gitar", "keyboard", "piano", "drum", "warnet", "rental game"],
  ["gorden", "gordyn", "kerai", "wallpaper", "karpet", "toko karpet", "gorden rumah", "roller blind", "vertical blind", "toko gorden"],

  // --- Pendidikan (per jenjang — istilah sesuai penamaan sekolah di Google Maps) ---
  ["sekolah dasar", "sekolah sd", "sd", "sd negeri", "sd swasta", "sd islam", "sdit", "madrasah ibtidaiyah", "mi", "sekolah dasar islam"],
  ["sekolah smp", "smp", "smp negeri", "smp swasta", "smp islam", "smpit", "madrasah tsanawiyah", "mts", "sekolah menengah pertama"],
  ["sekolah sma", "sma", "sma negeri", "sma swasta", "sma islam", "ma", "madrasah aliyah", "sekolah menengah atas"],
  ["sekolah smk", "smk", "smk negeri", "smk swasta", "smk islam", "smkit", "sekolah kejuruan", "sekolah menengah kejuruan"],
  ["taman kanak kanak", "taman kanak-kanak", "tk", "paud", "kb", "kelompok bermain", "ra", "raudhatul athfal", "daycare", "playgroup"],
  ["kampus", "universitas", "sekolah tinggi", "politeknik", "poltekkes", "stikes", "akademi", "institut", "perguruan tinggi"],
  ["toko atk", "atk", "alat tulis", "toko buku", "buku", "seragam", "seragam sekolah", "toko seragam", "toko seragam sekolah"],
  ["pesantren", "pondok pesantren", "majelis taklim", "majlis taklim", "tpq", "taman pendidikan al quran", "tpa", "madrasah diniyah", "diniyah"],
  ["kursus komputer", "pelatihan kerja", "balai latihan kerja", "blk", "sanggar tari", "sanggar seni", "sanggar", "kursus vokal"],

  // --- Ibadah & Keagamaan ---
  ["masjid", "mesjid", "mushola", "musala", "langgar", "surau", "musholla", "masjid besar"],
  ["gereja", "pura", "vihara", "kelenteng", "tempat ibadah", "rumah ibadah"],

  // --- Keuangan ---
  ["bank", "bank syariah", "atm", "koperasi", "koperasi simpan pinjam", "ksp", "pegadaian", "asuransi", "leasing", "multifinance", "bmt", "kantor bank", "pawnshop"],

  // --- Layanan Publik ---
  ["kantor pos", "pos indonesia", "kantor desa", "balai desa", "kantor camat", "kantor kecamatan", "kantor kelurahan", "kantor polisi", "polsek", "polres", "pemadam kebakaran", "damkar", "koramil"],

  // --- Hiburan & Olahraga ---
  ["futsal", "lapangan futsal", "kolam renang", "renang", "karaoke", "billiard", "biliar", "bowling", "game center", "lapangan basket", "lapangan voli", "kolam renang murah", "tempat renang"],
  ["playground", "tempat main anak", "taman bermain anak", "playland", "kolam pancing", "taman pancing", "taman bermain"],

  // --- Wisata ---
  ["wisata", "objek wisata", "tempat wisata", "pemandian", "pemandian air panas", "air terjun", "taman wisata", "agrowisata", "kebun binatang", "curug", "pantai", "bukit", "taman kota", "alun alun", "destinasi wisata", "taman rekreasi"],

  // --- Pertanian & Peternakan ---
  ["toko pakan", "pakan ternak", "toko pertanian", "kios tani", "saprodi", "pupuk", "benih", "obat tanaman", "alat pertanian", "peternakan", "mesin pertanian", "traktor", "kios pertanian"],
];
