// Azure TTS 音色清单(edge-tts voices, 主流语言全覆盖)
// 用于前端音色下拉选择 + 一键添加全部音色为模型
export interface AzureVoice {
  id: string
  label: string
  /** 语言分组(中文显示): 中文 | 粤语/繁体 | 英语 | 日语 | 韩语 | 法语 | 德语 | 俄语 | 西班牙语 | 意大利语 | 葡萄牙语 | 其他 */
  group?: string
}

/** 按音色 id 推断语言分组(中文标注) */
export function voiceGroup(id: string): string {
  if (id.startsWith('zh-CN')) return '中文'
  if (id.startsWith('zh-HK') || id.startsWith('zh-TW')) return '粤语/繁体'
  if (id.startsWith('en-')) return '英语'
  if (id.startsWith('ja-')) return '日语'
  if (id.startsWith('ko-')) return '韩语'
  if (id.startsWith('fr-')) return '法语'
  if (id.startsWith('de-')) return '德语'
  if (id.startsWith('ru-')) return '俄语'
  if (id.startsWith('es-')) return '西班牙语'
  if (id.startsWith('it-')) return '意大利语'
  if (id.startsWith('pt-')) return '葡萄牙语'
  return '其他'
}

export const AZURE_TTS_VOICES: AzureVoice[] = [
  // 中文(简体)
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓(女·温暖)' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊(女·可爱)' },
  { id: 'zh-CN-YunjianNeural', label: '云健(男·沉稳)' },
  { id: 'zh-CN-YunxiNeural', label: '云希(男·阳光)' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏(男童·清脆)' },
  { id: 'zh-CN-YunyangNeural', label: '云扬(男·新闻)' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北(女·东北)' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮(女·陕西)' },
  { id: 'zh-CN-YunfengNeural', label: '云峰(男·标准)' },
  { id: 'zh-CN-YunhaoNeural', label: '云皓(男·广告)' },
  { id: 'zh-CN-YunjieNeural', label: '云杰(男·活力)' },
  { id: 'zh-CN-YunzeNeural', label: '云泽(男·解说)' },
  { id: 'zh-CN-YunfanNeural', label: '云帆(男·旁白)' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰(女·欢快)' },
  { id: 'zh-CN-XiaohanNeural', label: '晓涵(女·温柔)' },
  { id: 'zh-CN-XiaomengNeural', label: '晓梦(女·甜美)' },
  { id: 'zh-CN-XiaomoNeural', label: '晓墨(女·播音)' },
  { id: 'zh-CN-XiaoqiuNeural', label: '晓秋(女·自然)' },
  { id: 'zh-CN-XiaoruiNeural', label: '晓睿(女·童声)' },
  { id: 'zh-CN-XiaoshuangNeural', label: '晓双(女·童声)' },
  { id: 'zh-CN-XiaoxuanNeural', label: '晓萱(女·学术)' },
  { id: 'zh-CN-XiaoyanNeural', label: '晓颜(女·训练)' },
  { id: 'zh-CN-XiaoyouNeural', label: '晓悠(女·童声)' },
  { id: 'zh-CN-XiaozhenNeural', label: '晓甄(女·温柔)' },
  { id: 'zh-CN-YunxiMultilingualNeural', label: '云希(多语言)' },
  { id: 'zh-CN-XiaoxiaoMultilingualNeural', label: '晓晓(多语言)' },
  // 中文(繁体/粤语/台湾)
  { id: 'zh-HK-HiuGaaiNeural', label: '曉佳(粤语·女)' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼(粤语·女)' },
  { id: 'zh-HK-WanLungNeural', label: '雲龍(粤语·男)' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻(台语·女)' },
  { id: 'zh-TW-HsiaoYuNeural', label: '曉雨(台语·女)' },
  { id: 'zh-TW-YunJheNeural', label: '雲哲(台语·男)' },
  // 英文(美国)
  { id: 'en-US-AriaNeural', label: 'Aria(女)' },
  { id: 'en-US-JennyNeural', label: 'Jenny(女)' },
  { id: 'en-US-MichelleNeural', label: 'Michelle(女)' },
  { id: 'en-US-AnaNeural', label: 'Ana(女·童声)' },
  { id: 'en-US-SaraNeural', label: 'Sara(女)' },
  { id: 'en-US-EmmaNeural', label: 'Emma(女)' },
  { id: 'en-US-AvaNeural', label: 'Ava(女)' },
  { id: 'en-US-GuyNeural', label: 'Guy(男)' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher(男)' },
  { id: 'en-US-EricNeural', label: 'Eric(男)' },
  { id: 'en-US-RogerNeural', label: 'Roger(男)' },
  { id: 'en-US-SteffanNeural', label: 'Steffan(男)' },
  { id: 'en-US-AndrewNeural', label: 'Andrew(男)' },
  { id: 'en-US-BrianNeural', label: 'Brian(男)' },
  { id: 'en-US-BrandonNeural', label: 'Brandon(男)' },
  { id: 'en-US-DavisNeural', label: 'Davis(男)' },
  { id: 'en-US-TonyNeural', label: 'Tony(男)' },
  { id: 'en-US-AIGenerate1Neural', label: 'AI Generate 1' },
  { id: 'en-US-AIGenerate2Neural', label: 'AI Generate 2' },
  { id: 'en-US-BlueNeural', label: 'Blue(男·歌唱)' },
  { id: 'en-US-JasonNeural', label: 'Jason(男)' },
  { id: 'en-US-NancyNeural', label: 'Nancy(女)' },
  { id: 'en-US-ClaraNeural', label: 'Clara(女)' },
  // 英文(英国/澳洲/其他)
  { id: 'en-GB-SoniaNeural', label: 'Sonia(英·女)' },
  { id: 'en-GB-LibbyNeural', label: 'Libby(英·女)' },
  { id: 'en-GB-MaisieNeural', label: 'Maisie(英·女)' },
  { id: 'en-GB-RyanNeural', label: 'Ryan(英·男)' },
  { id: 'en-GB-ThomasNeural', label: 'Thomas(英·男)' },
  { id: 'en-GB-OliverNeural', label: 'Oliver(英·男)' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha(澳·女)' },
  { id: 'en-AU-WilliamNeural', label: 'William(澳·男)' },
  { id: 'en-AU-AnnetteNeural', label: 'Annette(澳·女)' },
  { id: 'en-AU-ElsieNeural', label: 'Elsie(澳·女)' },
  { id: 'en-AU-TimNeural', label: 'Tim(澳·男)' },
  { id: 'en-CA-ClaraNeural', label: 'Clara(加·女)' },
  { id: 'en-CA-LiamNeural', label: 'Liam(加·男)' },
  { id: 'en-IN-NeerjaNeural', label: 'Neerja(印·女)' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat(印·男)' },
  // 日语
  { id: 'ja-JP-NanamiNeural', label: 'Nanami(女)' },
  { id: 'ja-JP-KeitaNeural', label: 'Keita(男)' },
  { id: 'ja-JP-AoiNeural', label: 'Aoi(女)' },
  { id: 'ja-JP-DaichiNeural', label: 'Daichi(男)' },
  { id: 'ja-JP-MayumiNeural', label: 'Mayumi(女)' },
  { id: 'ja-JP-NaokiNeural', label: 'Naoki(男)' },
  { id: 'ja-JP-ShioriNeural', label: 'Shiori(女)' },
  // 韩语
  { id: 'ko-KR-SunHiNeural', label: 'SunHi(女)' },
  { id: 'ko-KR-InJoonNeural', label: 'InJoon(男)' },
  { id: 'ko-KR-HyunsuNeural', label: 'Hyunsu(男)' },
  { id: 'ko-KR-JiMinNeural', label: 'JiMin(女)' },
  { id: 'ko-KR-SeoHyeonNeural', label: 'SeoHyeon(女)' },
  // 法语
  { id: 'fr-FR-DeniseNeural', label: 'Denise(女)' },
  { id: 'fr-FR-EliseNeural', label: 'Elise(女)' },
  { id: 'fr-FR-VivienneNeural', label: 'Vivienne(女)' },
  { id: 'fr-FR-HenriNeural', label: 'Henri(男)' },
  { id: 'fr-FR-RemyNeural', label: 'Remy(男)' },
  { id: 'fr-CA-SylvieNeural', label: 'Sylvie(加·女)' },
  { id: 'fr-CA-AntoineNeural', label: 'Antoine(加·男)' },
  // 德语
  { id: 'de-DE-KatjaNeural', label: 'Katja(女)' },
  { id: 'de-DE-LouisaNeural', label: 'Louisa(女)' },
  { id: 'de-DE-AmalaNeural', label: 'Amala(女)' },
  { id: 'de-DE-ConradNeural', label: 'Conrad(男)' },
  { id: 'de-DE-BerndNeural', label: 'Bernd(男)' },
  { id: 'de-DE-FlorianNeural', label: 'Florian(男)' },
  { id: 'de-DE-ChristophNeural', label: 'Christoph(男)' },
  { id: 'de-DE-GiselaNeural', label: 'Gisela(女)' },
  { id: 'de-DE-LeniNeural', label: 'Leni(女)' },
  { id: 'de-AT-IngridNeural', label: 'Ingrid(奥·女)' },
  { id: 'de-AT-JonasNeural', label: 'Jonas(奥·男)' },
  // 俄语
  { id: 'ru-RU-SvetlanaNeural', label: 'Svetlana(女)' },
  { id: 'ru-RU-DariyaNeural', label: 'Dariya(女)' },
  { id: 'ru-RU-DmitryNeural', label: 'Dmitry(男)' },
  { id: 'ru-RU-PavelNeural', label: 'Pavel(男)' },
  // 西班牙语
  { id: 'es-ES-ElviraNeural', label: 'Elvira(西·女)' },
  { id: 'es-ES-AlvaroNeural', label: 'Alvaro(西·男)' },
  { id: 'es-ES-AbrilNeural', label: 'Abril(西·女)' },
  { id: 'es-ES-ArnauNeural', label: 'Arnau(西·男)' },
  { id: 'es-MX-DaliaNeural', label: 'Dalia(墨·女)' },
  { id: 'es-MX-JorgeNeural', label: 'Jorge(墨·男)' },
  { id: 'es-AR-ElenaNeural', label: 'Elena(阿·女)' },
  { id: 'es-AR-TomasNeural', label: 'Tomas(阿·男)' },
  // 意大利语
  { id: 'it-IT-ElsaNeural', label: 'Elsa(女)' },
  { id: 'it-IT-IsabellaNeural', label: 'Isabella(女)' },
  { id: 'it-IT-DiegoNeural', label: 'Diego(男)' },
  { id: 'it-IT-BenignoNeural', label: 'Benigno(男)' },
  // 葡萄牙语
  { id: 'pt-BR-FranciscaNeural', label: 'Francisca(巴·女)' },
  { id: 'pt-BR-AntonioNeural', label: 'Antonio(巴·男)' },
  { id: 'pt-BR-ThalitaNeural', label: 'Thalita(巴·女)' },
  { id: 'pt-PT-RaquelNeural', label: 'Raquel(葡·女)' },
  { id: 'pt-PT-DuarteNeural', label: 'Duarte(葡·男)' },
  // 其他语言
  { id: 'ar-SA-ZariyahNeural', label: 'Zariyah(阿语·女)' },
  { id: 'ar-SA-HamedNeural', label: 'Hamed(阿语·男)' },
  { id: 'hi-IN-SwaraNeural', label: 'Swara(印地·女)' },
  { id: 'hi-IN-MadhurNeural', label: 'Madhur(印地·男)' },
  { id: 'id-ID-GadisNeural', label: 'Gadis(印尼·女)' },
  { id: 'id-ID-ArdiNeural', label: 'Ardi(印尼·男)' },
  { id: 'th-TH-PremwadeeNeural', label: 'Premwadee(泰·女)' },
  { id: 'th-TH-NiwatNeural', label: 'Niwat(泰·男)' },
  { id: 'vi-VN-HoaiMyNeural', label: 'HoaiMy(越·女)' },
  { id: 'vi-VN-NamMinhNeural', label: 'NamMinh(越·男)' },
  { id: 'tr-TR-EmelNeural', label: 'Emel(土·女)' },
  { id: 'tr-TR-AhmetNeural', label: 'Ahmet(土·男)' },
  { id: 'pl-PL-ZofiaNeural', label: 'Zofia(波·女)' },
  { id: 'pl-PL-MarekNeural', label: 'Marek(波·男)' },
  { id: 'nl-NL-ColetteNeural', label: 'Colette(荷·女)' },
  { id: 'nl-NL-FennaNeural', label: 'Fenna(荷·女)' },
  { id: 'nl-NL-MaartenNeural', label: 'Maarten(荷·男)' },
  { id: 'sv-SE-SofieNeural', label: 'Sofie(瑞·女)' },
  { id: 'sv-SE-MattiasNeural', label: 'Mattias(瑞·男)' },
  { id: 'uk-UA-PolinaNeural', label: 'Polina(乌·女)' },
  { id: 'uk-UA-OstapNeural', label: 'Ostap(乌·男)' },
  { id: 'cs-CZ-VlastaNeural', label: 'Vlasta(捷·女)' },
  { id: 'cs-CZ-AntoninNeural', label: 'Antonin(捷·男)' },
  { id: 'da-DK-ChristelNeural', label: 'Christel(丹·女)' },
  { id: 'da-DK-JeppeNeural', label: 'Jeppe(丹·男)' },
  { id: 'fi-FI-SelmaNeural', label: 'Selma(芬·女)' },
  { id: 'fi-FI-HarriNeural', label: 'Harri(芬·男)' },
  { id: 'el-GR-AthinaNeural', label: 'Athina(希·女)' },
  { id: 'el-GR-NestorasNeural', label: 'Nestoras(希·男)' },
  { id: 'he-IL-HilaNeural', label: 'Hila(希伯来·女)' },
  { id: 'he-IL-AvriNeural', label: 'Avri(希伯来·男)' },
  { id: 'nb-NO-PernilleNeural', label: 'Pernille(挪·女)' },
  { id: 'nb-NO-FinnNeural', label: 'Finn(挪·男)' },
]

/** 判断字符串是否是已知音色 id */
export function isAzureVoiceId(id: string): boolean {
  return AZURE_TTS_VOICES.some((v) => v.id === id)
}
