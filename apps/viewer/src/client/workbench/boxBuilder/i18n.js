// Box builder: English and Ukrainian UI text. The language follows the browser
// (Ukrainian when the browser's first language is Ukrainian, English otherwise)
// until the visitor picks one; the pick is remembered in this browser. The sign-in
// page a hosted builder serves in front of the app reads and writes the same key.

export const BOX_LANGUAGES = Object.freeze(["en", "uk"]);
export const BOX_LANGUAGE_STORAGE_KEY = "3dmaker:lang";

const EN = {
  "sheet.title": "Box builder",
  "tab.body": "Body",
  "tab.lid": "Lid",
  "tab.holes": "Holes",
  "tab.standoffs": "Standoffs",
  "tab.file": "File",

  "action.center": "Center",
  "action.copy": "Copy",
  "action.delete": "Delete",

  "section.floor": "Floor",
  "field.width": "Width (X)",
  "field.depth": "Depth (Y)",
  "field.floorThickness": "Floor thickness",
  "field.cornerRadius": "Corner radius",
  "section.walls": "Walls",
  "field.wallHeight": "Wall height",
  "field.wallThickness": "Wall thickness",
  "section.dimensions": "Dimensions",
  "field.overall": "Overall",
  "field.inside": "Inside",

  "lid.needsWalls": "The lid appears once the walls are on.",
  "section.lid": "Lid",
  "field.thickness": "Thickness",
  "section.lip": "Lip",
  "field.height": "Height",
  "field.clearance": "Clearance",
  "field.lipSize": "Lip size",

  "item.hole": "Hole {n}",
  "field.face": "Face",
  "field.shape": "Shape",
  "face.off": "{face} (off)",
  "field.acrossFlats": "Across flats",
  "field.diameter": "Diameter",
  "field.radius": "Radius",
  "field.rotation": "Rotation",
  "section.newHole": "New hole",
  "action.addHole": "Add hole",
  "section.holes": "Holes",
  "holes.empty": "No holes yet.",

  "face.floor": "Floor",
  "face.front": "Front wall",
  "face.back": "Back wall",
  "face.left": "Left wall",
  "face.right": "Right wall",
  "face.lid": "Lid",

  "shape.circle": "Circle",
  "shape.rect": "Rectangle",
  "shape.slot": "Slot",
  "shape.hex": "Hexagon",

  "pattern.line": "2 in a line",
  "pattern.triangle": "Triangle",
  "pattern.rect": "Rectangle",

  "axis.along": "Along",
  "axis.fromBottom": "From bottom",
  "axis.x": "X",
  "axis.y": "Y",
  "size.width": "Width",
  "size.height": "Height",
  "size.x": "Along X",
  "size.y": "Along Y",

  "item.standoffs": "Standoffs {n}",
  "field.pattern": "Pattern",
  "field.spacing": "Hole spacing",
  "field.spacingFirst": "Spacing: {axis}",
  "spacing.base": "Base",
  "spacing.apex": "To apex",
  "spacing.x": "Along X",
  "spacing.y": "Along Y",
  "field.holeDiameter": "Hole ⌀",
  "field.padDiameter": "Pad ⌀",
  "field.centerX": "Center X",
  "field.centerY": "Center Y",
  "section.newStandoffs": "New standoffs",
  "action.addStandoffs": "Add PCB standoffs",
  "section.standoffs": "Standoffs",
  "standoffs.empty": "No standoffs yet.",

  "build.queued": "Queued for building…",
  "build.running": "Building STEP, STL and 3MF…",
  "build.doneAt": "Built at {time}.",
  "build.done": "Built.",
  "part.base": "Base",
  "part.lid": "Lid",
  "quota.new": "new {used}/{limit}",
  "quota.builds": "builds {used}/{limit}",
  "confirm.open": "Open “{name}”? Unsaved changes to the current box will be lost.",
  "confirm.new": "Start a new box? Unsaved changes will be lost.",
  "section.box": "Box",
  "field.name": "Name",
  "field.nameAria": "Box name",
  "name.invalid": "Name: Latin letters, digits, “-” or “_”.",
  "field.folder": "Folder",
  "field.state": "State",
  "state.unsaved": "Not saved",
  "state.saved": "Saved",
  "field.today": "Today",
  "section.build": "Build",
  "action.building": "Building…",
  "action.save": "Save and build",
  "action.download": "Download {format}",
  "action.openStep": "Open STEP in the viewer",
  "action.pathCopied": "Path copied",
  "action.copyPath": "Copy folder path",
  "section.open": "Open",
  "field.savedBoxes": "Saved boxes",
  "saved.empty": "No saved boxes yet.",
  "action.open": "Open",
  "action.newBox": "New box",
  "section.history": "History",
  "action.undo": "Undo",
  "action.redo": "Redo",
  "section.check": "Check",

  "warning.standoffsOutside": "Standoffs {n}: outside the floor.",
  "warning.standoffsTall": "Standoffs {n}: taller than the walls.",
  "warning.holeFaceOff": "Hole {n}: the {face} is off, so the hole does nothing.",
  "warning.holeOutside": "Hole {n}: runs past the edge of its face.",

  "error.quota_new": "Today's new box is already made. You can keep editing and rebuilding it; make a new one tomorrow.",
  "error.quota_builds": "Today's build limit is used up. Try again tomorrow.",
  "error.busy": "The server is building other boxes. Try again in a minute.",
  "error.busy_account": "Your previous box is still building. Wait until it is ready.",
  "error.quota_global": "The service has made all its new boxes for today. Try again tomorrow.",
  "error.quota_disk": "Your boxes have used all of their storage space.",
  "error.quota_unavailable": "Limits are unavailable right now. Try again a little later.",
  "error.disk_full": "The server is running out of space. Try again later.",
  "error.too_large": "The box is too large to save.",
  "error.unauthorized": "Your session has ended. Reload the page and sign in again.",
  "error.internal": "Something went wrong on the server. Try again.",
  "error.too_many_requests": "Too many requests. Wait a minute.",
  "error.bad_plan": "The geometry failed a check: {message}",

  "view.iso": "Iso",
  "view.top": "Top",
  "view.front": "Front",
  "view.side": "Side",
  "lid.open": "Explode",
  "lid.closed": "Close",
  "lid.hidden": "Hide",
  "lid.viewAria": "Lid in the view",
  "viewport.warnings": "Warnings: {count}",
  "viewport.loading": "Loading the 3D engine…",
  "viewport.loadError": "Could not load the 3D engine: {error}",
  "viewport.geometryError": "Geometry error: {error}",
  "viewport.hint": "Drag standoffs and holes (Shift: 0.1 mm steps) · arrows: move 1 mm (Shift: 10) · Ctrl+D: copy · Del: delete · Ctrl+Z / Ctrl+Y · coordinates from the box center",
  "unit.mm": "mm",
  "footer.source": "Open source on GitHub",

  "language.label": "Language",
  "account.signOut": "Sign out",
  "builder.open": "Box builder",
  "builder.close": "Close box builder",
  "links.version": "Version of this build",
  "links.telegram": "Telegram group",
  "links.source": "Source code on GitHub",
  "links.admin": "Admin",
  "viewport.warningsHint": "Click a warning to select its item.",
  "section.array": "Array: {item}",
  "field.direction": "Direction",
  "array.dir.plane.+u": "→ +X",
  "array.dir.plane.-u": "← −X",
  "array.dir.plane.+v": "↑ +Y",
  "array.dir.plane.-v": "↓ −Y",
  "array.dir.wall.+u": "→ Along",
  "array.dir.wall.-u": "← Along",
  "array.dir.wall.+v": "↑ Up",
  "array.dir.wall.-v": "↓ Down",
  "field.arrayMode": "Placement",
  "array.mode.count": "Count and step",
  "array.mode.fill": "Step to the edge",
  "array.mode.even": "Evenly to the edge",
  "field.copies": "Copies",
  "field.rowCount": "Elements in the row",
  "field.step": "Step",
  "field.arraySpacing": "Spacing",
  "field.arrayResult": "Will add",
  "array.result": "{count} copies",
  "array.skipped": "{count} would go past the edge and are skipped.",
  "action.createArray": "Create array"
};

const UK = {
  "sheet.title": "Конструктор коробки",
  "tab.body": "Корпус",
  "tab.lid": "Кришка",
  "tab.holes": "Отвори",
  "tab.standoffs": "Ніжки",
  "tab.file": "Файл",

  "action.center": "По центру",
  "action.copy": "Копія",
  "action.delete": "Видалити",

  "section.floor": "Дно",
  "field.width": "Ширина (X)",
  "field.depth": "Глибина (Y)",
  "field.floorThickness": "Товщина дна",
  "field.cornerRadius": "Радіус кутів",
  "section.walls": "Стінки",
  "field.wallHeight": "Висота стінок",
  "field.wallThickness": "Товщина стінок",
  "section.dimensions": "Розміри",
  "field.overall": "Габарит",
  "field.inside": "Всередині",

  "lid.needsWalls": "Кришка з'явиться, коли увімкнені стінки.",
  "section.lid": "Кришка",
  "field.thickness": "Товщина",
  "section.lip": "Бортик",
  "field.height": "Висота",
  "field.clearance": "Зазор",
  "field.lipSize": "Розмір бортика",

  "item.hole": "Отвір {n}",
  "field.face": "Грань",
  "field.shape": "Форма",
  "face.off": "{face} (вимкнена)",
  "field.acrossFlats": "Під ключ",
  "field.diameter": "Діаметр",
  "field.radius": "Радіус",
  "field.rotation": "Поворот",
  "section.newHole": "Новий отвір",
  "action.addHole": "Додати отвір",
  "section.holes": "Отвори",
  "holes.empty": "Отворів ще немає.",

  "face.floor": "Дно",
  "face.front": "Передня стінка",
  "face.back": "Задня стінка",
  "face.left": "Ліва стінка",
  "face.right": "Права стінка",
  "face.lid": "Кришка",

  "shape.circle": "Коло",
  "shape.rect": "Прямокутник",
  "shape.slot": "Овал",
  "shape.hex": "Шестикутник",

  "pattern.line": "2 в лінію",
  "pattern.triangle": "Трикутник",
  "pattern.rect": "Прямокутник",

  "axis.along": "Вздовж",
  "axis.fromBottom": "Від низу",
  "axis.x": "X",
  "axis.y": "Y",
  "size.width": "Ширина",
  "size.height": "Висота",
  "size.x": "По X",
  "size.y": "По Y",

  "item.standoffs": "Ніжки {n}",
  "field.pattern": "Схема",
  "field.spacing": "Між центрами",
  "field.spacingFirst": "Між центрами: {axis}",
  "spacing.base": "Основа",
  "spacing.apex": "До вершини",
  "spacing.x": "По X",
  "spacing.y": "По Y",
  "field.holeDiameter": "Отвір ⌀",
  "field.padDiameter": "Опора ⌀",
  "field.centerX": "Центр X",
  "field.centerY": "Центр Y",
  "section.newStandoffs": "Нові ніжки",
  "action.addStandoffs": "Додати ніжки під плату",
  "section.standoffs": "Ніжки",
  "standoffs.empty": "Ніжок ще немає.",

  "build.queued": "У черзі на збірку…",
  "build.running": "Збираю STEP, STL і 3MF…",
  "build.doneAt": "Зібрано о {time}.",
  "build.done": "Зібрано.",
  "part.base": "Основа",
  "part.lid": "Кришка",
  "quota.new": "нових {used}/{limit}",
  "quota.builds": "збірок {used}/{limit}",
  "confirm.open": "Відкрити «{name}»? Незбережені зміни поточної коробки пропадуть.",
  "confirm.new": "Почати нову коробку? Незбережені зміни пропадуть.",
  "section.box": "Коробка",
  "field.name": "Назва",
  "field.nameAria": "Назва коробки",
  "name.invalid": "Назва: латиниця, цифри, «-» або «_».",
  "field.folder": "Папка",
  "field.state": "Стан",
  "state.unsaved": "Не збережено",
  "state.saved": "Збережено",
  "field.today": "Сьогодні",
  "section.build": "Збірка",
  "action.building": "Збираю…",
  "action.save": "Зберегти і зібрати",
  "action.download": "Завантажити {format}",
  "action.openStep": "Відкрити STEP у переглядачі",
  "action.pathCopied": "Шлях скопійовано",
  "action.copyPath": "Копіювати шлях до папки",
  "section.open": "Відкрити",
  "field.savedBoxes": "Збережені",
  "saved.empty": "Збережених коробок ще немає.",
  "action.open": "Відкрити",
  "action.newBox": "Нова коробка",
  "section.history": "Історія",
  "action.undo": "Скасувати",
  "action.redo": "Повторити",
  "section.check": "Перевірка",

  "warning.standoffsOutside": "Ніжки {n}: виходять за межі дна.",
  "warning.standoffsTall": "Ніжки {n}: вищі за стінки.",
  "warning.holeFaceOff": "Отвір {n}: {face} вимкнена, отвір не діє.",
  "warning.holeOutside": "Отвір {n}: виходить за край грані.",

  "error.quota_new": "Сьогоднішню нову коробку вже створено. Її можна змінювати й перезбирати, а нову — завтра.",
  "error.quota_builds": "Ліміт збірок на сьогодні вичерпано. Спробуйте завтра.",
  "error.busy": "Сервер зараз збирає інші коробки. Спробуйте за хвилину.",
  "error.busy_account": "Попередня коробка ще збирається. Зачекайте, поки вона буде готова.",
  "error.quota_global": "Сервіс сьогодні вже створив максимум нових коробок. Спробуйте завтра.",
  "error.quota_disk": "Ваші коробки зайняли все відведене місце.",
  "error.quota_unavailable": "Ліміти тимчасово недоступні. Спробуйте трохи пізніше.",
  "error.disk_full": "На сервері закінчується місце. Спробуйте пізніше.",
  "error.too_large": "Коробка завелика для збереження.",
  "error.unauthorized": "Сесія завершилась. Оновіть сторінку й увійдіть знову.",
  "error.internal": "На сервері щось пішло не так. Спробуйте ще раз.",
  "error.too_many_requests": "Забагато запитів. Зачекайте хвилину.",
  "error.bad_plan": "Геометрія не пройшла перевірку: {message}",

  "view.iso": "Ізо",
  "view.top": "Зверху",
  "view.front": "Спереду",
  "view.side": "Збоку",
  "lid.open": "Розсунути",
  "lid.closed": "Закрити",
  "lid.hidden": "Сховати",
  "lid.viewAria": "Кришка у вікні",
  "viewport.warnings": "Зауважень: {count}",
  "viewport.loading": "Завантажую 3D-ядро…",
  "viewport.loadError": "Не вдалося завантажити 3D-ядро: {error}",
  "viewport.geometryError": "Помилка геометрії: {error}",
  "viewport.hint": "Тягніть ніжки й отвори мишею (Shift: крок 0,1 мм) · стрілки: зсув на 1 мм (Shift: 10) · Ctrl+D: копія · Del: видалити · Ctrl+Z / Ctrl+Y · координати від центру коробки",
  "unit.mm": "мм",
  "footer.source": "Відкритий код на GitHub",

  "language.label": "Мова",
  "account.signOut": "Вийти",
  "builder.open": "Конструктор коробок",
  "builder.close": "Закрити конструктор коробок",
  "links.version": "Версія цієї збірки",
  "links.telegram": "Група в Telegram",
  "links.source": "Код на GitHub",
  "links.admin": "Адмінка",
  "viewport.warningsHint": "Натисніть на зауваження, щоб виділити елемент.",
  "section.array": "Масив: {item}",
  "field.direction": "Напрямок",
  "array.dir.plane.+u": "→ +X",
  "array.dir.plane.-u": "← −X",
  "array.dir.plane.+v": "↑ +Y",
  "array.dir.plane.-v": "↓ −Y",
  "array.dir.wall.+u": "→ Вздовж",
  "array.dir.wall.-u": "← Вздовж",
  "array.dir.wall.+v": "↑ Вгору",
  "array.dir.wall.-v": "↓ Вниз",
  "field.arrayMode": "Розміщення",
  "array.mode.count": "Кількість і крок",
  "array.mode.fill": "Крок до краю",
  "array.mode.even": "Рівномірно до краю",
  "field.copies": "Копій",
  "field.rowCount": "Елементів у ряду",
  "field.step": "Крок",
  "field.arraySpacing": "Відстань",
  "field.arrayResult": "Буде додано",
  "array.result": "копій: {count}",
  "array.skipped": "Не вміщаються в межі й пропущені: {count}.",
  "action.createArray": "Створити масив"
};

export const BOX_MESSAGES = Object.freeze({ en: Object.freeze(EN), uk: Object.freeze(UK) });

export function detectLanguage(browserLanguage) {
  const primary = String(browserLanguage || "").trim().toLowerCase();
  return primary === "uk" || primary.startsWith("uk-") ? "uk" : "en";
}

export function normalizeLanguage(value) {
  return BOX_LANGUAGES.includes(value) ? value : "";
}

export function translate(language, key, params = {}) {
  const table = BOX_MESSAGES[language] || BOX_MESSAGES.en;
  const template = table[key] ?? BOX_MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
}

// A warning from boxSpecWarnings ({ key, params }) as a sentence.
export function formatWarning(language, warning) {
  const params = { ...(warning?.params || {}) };
  if (params.face) {
    params.face = translate(language, `face.${params.face}`).toLowerCase();
  }
  return translate(language, warning?.key || "", params);
}

// --- the visitor's choice (browser only) --------------------------------------

const listeners = new Set();
let currentLanguage = "";

function readInitialLanguage() {
  if (typeof window === "undefined") {
    return "en";
  }
  try {
    const stored = normalizeLanguage(window.localStorage.getItem(BOX_LANGUAGE_STORAGE_KEY));
    if (stored) {
      return stored;
    }
  } catch {
    // Storage blocked: fall back to the browser's language.
  }
  return detectLanguage(window.navigator?.language);
}

export function getBoxLanguage() {
  if (!currentLanguage) {
    currentLanguage = readInitialLanguage();
  }
  return currentLanguage;
}

export function setBoxLanguage(language) {
  const next = normalizeLanguage(language);
  if (!next || next === getBoxLanguage()) {
    return;
  }
  currentLanguage = next;
  try {
    window.localStorage.setItem(BOX_LANGUAGE_STORAGE_KEY, next);
  } catch {
    // The pick then lasts for this page only.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeBoxLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
