/**
 * Vietnamese intent words for catalog search.
 *
 * Keys are folded Vietnamese words or phrases (no diacritics, `đ` as `d`,
 * single spaces); values are English words the block index already holds.
 * An empty value marks a filler word ("và", "theo") that is dropped like an
 * English stop word.
 * `expandVietnamese` swaps the longest matching phrase first, so "biểu đồ cột"
 * reads as "chart" rather than "chart" plus a stray "cot".
 *
 * A key must not be an English word the index or the stop list already
 * holds, so an English query never changes meaning. The unit tests enforce
 * that, and that every value is a word the index can match.
 */

export const VI_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Filler words
  cac: [],
  cho: [],
  cua: [],
  mot: [],
  nhung: [],
  theo: [],
  trong: [],
  va: [],
  voi: [],
  // Common phrases that share a folded word with an alias ("giá trị" is not
  // "giá", "động" is not "dòng"); they claim those words so nothing misleads.
  'chuyen dong': [],
  'dong ho': [],
  'hoat dong': [],
  'nhan manh': [],
  'phan tich': [],
  // Layout and structure
  'bo cuc': ['layout'],
  trang: ['page'],
  phan: ['section'],
  'khoang trang': ['spacing'],
  'duong ke': ['divider'],
  'phan cach': ['separator'],
  luoi: ['grid'],
  cot: ['columns'],
  dong: ['rows'],
  hang: ['rows'],
  'hai cot': ['two', 'column'],
  'chia doi': ['split'],
  'thanh ben': ['sidebar'],
  'xep chong': ['stack'],
  // "Thẻ" folds to the English stop word "the", so only phrases can say card.
  'the thong tin': ['card'],
  'the tinh nang': ['card'],
  // Content
  'tieu de': ['heading'],
  'van ban': ['text'],
  'doan van': ['paragraph'],
  'trich dan': ['quote'],
  ma: ['code'],
  'ma nguon': ['code'],
  'doan ma': ['snippet'],
  nhan: ['label'],
  'huy hieu': ['badge'],
  'phim tat': ['shortcut'],
  'ban phim': ['keyboard'],
  'bieu tuong': ['icon'],
  'canh bao': ['alert'],
  'thong bao': ['notice'],
  'ghi chu': ['note'],
  'trang chu': ['landing'],
  'trang dich': ['landing'],
  'gioi thieu': ['intro'],
  'cac buoc': ['steps'],
  'huong dan': ['steps'],
  'quy trinh': ['process'],
  'dong thoi gian': ['timeline'],
  'lich su': ['history'],
  'lich su kien': ['calendar', 'events'],
  'tai lieu': ['docs'],
  'danh sach': ['list'],
  'cau hoi thuong gap': ['faq'],
  'hoi dap': ['faq'],
  'tai lieu tham khao': ['references'],
  nguon: ['sources'],
  'trich nguon': ['citations'],
  'bai bao': ['article'],
  'bai viet': ['article'],
  'tin tuc': ['news'],
  bao: ['newspaper'],
  // Data
  bang: ['table'],
  'bang du lieu': ['data', 'table'],
  'du lieu': ['data'],
  'bao cao': ['report'],
  'gia tri': ['value'],
  'phan tram': ['percent'],
  'bieu do': ['chart'],
  'bieu do cot': ['chart'],
  'bieu do duong': ['chart'],
  'bieu do tron': ['chart'],
  'thong ke': ['stats'],
  'so lieu': ['numbers'],
  'chi so': ['metrics'],
  'tien do': ['progress'],
  'so sanh': ['comparison'],
  'rui ro': ['risk'],
  'danh sach kiem tra': ['checklist'],
  'viec can lam': ['tasks'],
  lich: ['calendar'],
  'lich trinh': ['schedule'],
  'su kien': ['events'],
  'ma tran tinh nang': ['feature', 'matrix'],
  'ma tran': ['matrix'],
  'tinh nang': ['features'],
  'phan bo': ['breakdown'],
  'co cau': ['composition'],
  'ngan sach': ['budget'],
  'hieu nang': ['performance'],
  'hieu suat': ['performance'],
  'diem chuan': ['benchmark'],
  // Engineering
  'so do': ['diagram'],
  'luu do': ['diagram'],
  'kien truc': ['architecture'],
  'dong lenh': ['terminal'],
  'cau lenh': ['commands'],
  'cay thu muc': ['file', 'tree'],
  tep: ['files'],
  'thay doi': ['changes'],
  'khac biet': ['diff'],
  'danh gia ma': ['code', 'review'],
  'danh gia': ['review'],
  'bang cong viec': ['kanban'],
  'lo trinh': ['roadmap'],
  'ke hoach': ['plan'],
  'kiem thu': ['tests'],
  'ket qua kiem thu': ['test', 'results'],
  'nhat ky': ['logs'],
  'diem cuoi': ['endpoint'],
  'luoc do': ['schema'],
  // Media and showcase
  anh: ['image'],
  hinh: ['image'],
  'hinh anh': ['image'],
  'anh chup man hinh': ['screenshot'],
  'thu vien anh': ['gallery'],
  'am thanh': ['audio'],
  'truoc sau': ['before', 'after'],
  'truoc va sau': ['before', 'after'],
  'logo khach hang': ['logos', 'customers'],
  'khach hang': ['customers'],
  'doi tac': ['partners'],
  'cam nhan khach hang': ['testimonial'],
  'loi chung thuc': ['testimonial'],
  'keu goi hanh dong': ['cta'],
  'dang ky': ['sign'],
  'noi bat': ['spotlight'],
  'trinh chieu': ['carousel'],
  // Product
  'bang gia': ['pricing'],
  gia: ['pricing'],
  goi: ['plans'],
  'doi ngu': ['team'],
  'nhan su': ['team'],
  'thanh vien': ['people'],
  // Interaction
  nut: ['button'],
  'nut bam': ['button'],
  'lien ket': ['link'],
  'thanh cong cu': ['toolbar'],
  'thanh truot': ['slider'],
  'tim kiem': ['search'],
  'bo loc': ['filter'],
  loc: ['filter'],
  'thanh loc': ['filter', 'bar'],
  'hop thoai': ['dialog'],
  'cua so': ['modal'],
  'thu gon': ['collapsible'],
  'o nhap': ['input'],
  'nhap lieu': ['input'],
  'lua chon': ['choice'],
  chon: ['select'],
  'hop kiem': ['checkbox'],
  'cong tac': ['switch'],
  'bat tat': ['toggle'],
  'trang thai': ['status'],
  ngay: ['date'],
  'quyet dinh': ['decision'],
  'phan hoi': ['feedback'],
  'gop y': ['feedback'],
};

/** Longest key, in words; bounds the phrase scan. */
const MAX_PHRASE_WORDS = Math.max(...Object.keys(VI_ALIASES).map((key) => key.split(' ').length));

/**
 * Replace each Vietnamese phrase in a run of folded words with its English
 * words, longest phrase first, left to right. Words that start no phrase stay
 * as they are, so English and mixed queries keep their own words.
 */
export function expandVietnamese(words: readonly string[]): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < words.length) {
    let matched = 0;
    for (let size = Math.min(MAX_PHRASE_WORDS, words.length - index); size > 0; size -= 1) {
      const english = VI_ALIASES[words.slice(index, index + size).join(' ')];
      if (english === undefined) continue;
      out.push(...english);
      matched = size;
      break;
    }
    if (matched === 0) {
      out.push(words[index] as string);
      matched = 1;
    }
    index += matched;
  }
  return out;
}
