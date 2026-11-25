/**
 * TIP · 날짜 계산기 (date-calc, v1.16.0)
 *
 * D-day, 날짜 더하기(일·주·개월), 만 나이, 근무일(주말 + 한국 공휴일 제외)을 한 화면에서 센다.
 * 공휴일은 2024~2027년의 법정 공휴일과 대체공휴일을 코드에 넣어 두었다(임시공휴일은 넣지 않았다).
 * 화면 아래에 어느 해까지 반영했는지 늘 적어 둔다. 인터넷을 쓰지 않는다.
 */

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2"/></svg>`;

/* ------------------------- 한국 공휴일 (2024~2027) ------------------------- */
// 법정 공휴일 + 대체공휴일. 임시공휴일(예: 2024-04-10 국회의원 선거일)은 넣지 않았다.
const HOLIDAYS = {
  2024: [
    '2024-01-01',
    '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12',
    '2024-03-01',
    '2024-05-05', '2024-05-06', '2024-05-15',
    '2024-06-06', '2024-08-15',
    '2024-09-16', '2024-09-17', '2024-09-18',
    '2024-10-03', '2024-10-09', '2024-12-25',
  ],
  2025: [
    '2025-01-01',
    '2025-01-28', '2025-01-29', '2025-01-30',
    '2025-03-01', '2025-03-03',
    '2025-05-05',
    '2025-06-06', '2025-08-15',
    '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09',
    '2025-12-25',
  ],
  2026: [
    '2026-01-01',
    '2026-02-16', '2026-02-17', '2026-02-18',
    '2026-03-01', '2026-03-02',
    '2026-05-05', '2026-05-24', '2026-05-25',
    '2026-06-06', '2026-06-08',
    '2026-08-15', '2026-08-17',
    '2026-09-24', '2026-09-25', '2026-09-26',
    '2026-10-03', '2026-10-05', '2026-10-09',
    '2026-12-25',
  ],
  2027: [
    '2027-01-01',
    '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
    '2027-03-01',
    '2027-05-05', '2027-05-13',
    '2027-06-06', '2027-06-07',
    '2027-08-15', '2027-08-16',
    '2027-09-14', '2027-09-15', '2027-09-16',
    '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11',
    '2027-12-25', '2027-12-27',
  ],
};

export const HOLIDAY_YEARS = [2024, 2025, 2026, 2027];
const HOLIDAY_SET = new Set(Object.values(HOLIDAYS).flat());
const HOLIDAY_RANGE_LABEL = `${HOLIDAY_YEARS[0]}~${HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1]}년`;
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/* ------------------------------- 날짜 계산 ------------------------------- */

function pad(value) {
  return String(value).padStart(2, '0');
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseISO(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dayNumber(date) {
  // UTC 기준 일 수 — 서머타임이 없는 한국에서도 날짜 차이가 정확하다.
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function diffDays(from, to) {
  return dayNumber(to) - dayNumber(from);
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** 개월 더하기 — 그 달에 없는 날(31일)은 그 달 마지막 날로 맞춘다. */
function addMonths(date, months) {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(date.getDate(), lastDay));
}

function koreanLabel(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_KO[date.getDay()]})`;
}

function isHoliday(date) {
  return HOLIDAY_SET.has(toISO(date));
}

/** 주말과 공휴일을 뺀 근무일 — 시작일과 끝나는 날을 모두 포함한다. */
export function businessDays(start, end) {
  let from = start;
  let to = end;
  if (diffDays(from, to) < 0) [from, to] = [to, from];
  let count = 0;
  let weekend = 0;
  let holiday = 0;
  let outsideYears = 0;
  const spanYears = new Set();
  for (let date = from; diffDays(date, to) >= 0; date = addDays(date, 1)) {
    spanYears.add(date.getFullYear());
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) {
      weekend += 1;
      continue;
    }
    if (!HOLIDAYS[date.getFullYear()]) outsideYears += 1;
    if (isHoliday(date)) {
      holiday += 1;
      continue;
    }
    count += 1;
  }
  return {
    days: diffDays(from, to) + 1,
    business: count,
    weekend,
    holiday,
    outsideYears,
    years: [...spanYears].sort((a, b) => a - b),
  };
}

/* -------------------------------- module ------------------------------- */

const TABS = [
  { id: 'dday', label: 'D-day' },
  { id: 'add', label: '날짜 더하기' },
  { id: 'age', label: '만 나이' },
  { id: 'work', label: '근무일' },
];

const module = {
  id: 'date-calc',
  name: '날짜 계산기',
  shortName: '날짜 계산',
  kind: 'tool',
  category: 'calc',
  version: '1.16.0',
  subtitle: 'D-day, 더하기, 만 나이, 근무일',
  description: 'D-day 를 세고, 날짜에 일, 주, 개월을 더하거나 빼고, 만 나이와 다음 생일을 확인하고, 주말과 한국 공휴일을 뺀 근무일을 셉니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const todayDate = today();
    const todayISO = toISO(todayDate);

    root.innerHTML = `
      <div class="v16 dc">
        <div class="v16-tabs" role="tablist" aria-label="날짜 계산 종류" id="dc-tabs"></div>

        <section class="v16-panel" id="dc-p-dday" role="tabpanel" aria-label="D-day">
          <div class="v16-field">
            <label class="v16-label" for="dc-dday-date">기준일</label>
            <input class="pt-input v16-input" id="dc-dday-date" type="date" value="${todayISO}">
          </div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="dc-dday-today">오늘로</button>
            <button class="v16-btn" type="button" id="dc-dday-plus100">100일 뒤</button>
          </div>
          <div class="dc-hero" id="dc-dday-out" aria-live="polite">
            <span class="dc-big">D-day</span>
            <span class="dc-sub">기준일을 고르세요</span>
          </div>
          <div class="v16-kv" id="dc-dday-rows"></div>
          <p class="v16-note">오늘(${koreanLabel(todayDate)})을 기준으로 셉니다.</p>
        </section>

        <section class="v16-panel" id="dc-p-add" role="tabpanel" aria-label="날짜 더하기" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dc-add-date">시작 날짜</label>
            <input class="pt-input v16-input" id="dc-add-date" type="date" value="${todayISO}">
          </div>
          <div class="v16-actions dc-add-row">
            <select class="pt-input v16-input" id="dc-add-dir" aria-label="더하기 또는 빼기">
              <option value="1">더하기</option>
              <option value="-1">빼기</option>
            </select>
            <input class="pt-input v16-input" id="dc-add-amount" type="number" inputmode="numeric" min="0" step="1" value="30" aria-label="얼마나">
            <select class="pt-input v16-input" id="dc-add-unit" aria-label="단위">
              <option value="day">일</option>
              <option value="week">주</option>
              <option value="month">개월</option>
            </select>
            <button class="v16-btn primary" type="button" id="dc-add-run">계산</button>
          </div>
          <div class="dc-hero" id="dc-add-out" aria-live="polite">
            <span class="dc-big">-</span>
            <span class="dc-sub">값을 넣고 계산을 누르세요</span>
          </div>
          <div class="v16-kv" id="dc-add-rows"></div>
        </section>

        <section class="v16-panel" id="dc-p-age" role="tabpanel" aria-label="만 나이" hidden>
          <div class="v16-field">
            <label class="v16-label" for="dc-age-date">태어난 날</label>
            <input class="pt-input v16-input" id="dc-age-date" type="date" value="${todayDate.getFullYear() - 30}-${pad(todayDate.getMonth() + 1)}-${pad(todayDate.getDate())}">
          </div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="dc-age-today">오늘로</button>
          </div>
          <div class="dc-hero" id="dc-age-out" aria-live="polite">
            <span class="dc-big">-</span>
            <span class="dc-sub">태어난 날을 고르세요</span>
          </div>
          <div class="v16-kv" id="dc-age-rows"></div>
        </section>

        <section class="v16-panel" id="dc-p-work" role="tabpanel" aria-label="근무일" hidden>
          <div class="v16-actions dc-add-row">
            <label class="v16-field dc-inline">
              <span class="v16-label">시작</span>
              <input class="pt-input v16-input" id="dc-work-start" type="date" value="${todayISO}">
            </label>
            <label class="v16-field dc-inline">
              <span class="v16-label">끝</span>
              <input class="pt-input v16-input" id="dc-work-end" type="date" value="${todayISO}">
            </label>
          </div>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="dc-work-run">근무일 세기</button>
            <button class="v16-btn" type="button" id="dc-work-month">이번 달</button>
          </div>
          <div class="dc-hero" id="dc-work-out" aria-live="polite">
            <span class="dc-big">-</span>
            <span class="dc-sub">기간을 정하세요</span>
          </div>
          <div class="v16-kv" id="dc-work-rows"></div>
          <p class="v16-note">주말과 ${HOLIDAY_RANGE_LABEL} 법정 공휴일(대체공휴일 포함)을 뺍니다. 임시공휴일은 넣지 않았습니다.</p>
        </section>
      </div>`;

    /* ------------------------------- 탭 ------------------------------- */

    const tabBar = root.querySelector('#dc-tabs');
    const panels = new Map(TABS.map((tab) => [tab.id, root.querySelector(`#dc-p-${tab.id}`)]));

    function selectTab(id) {
      TABS.forEach((tab) => {
        const button = tabBar.querySelector(`[data-tab="${tab.id}"]`);
        const selected = tab.id === id;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        panels.get(tab.id).hidden = !selected;
      });
      if (id === 'dday') paintDday();
      if (id === 'add') paintAdd();
      if (id === 'age') paintAge();
      if (id === 'work') paintWork();
    }

    TABS.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'v16-tab';
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.id === TABS[0].id));
      button.tabIndex = tab.id === TABS[0].id ? 0 : -1;
      button.addEventListener('click', () => selectTab(tab.id), { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = TABS.findIndex((entry) => entry.id === tab.id);
        const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        selectTab(next.id);
        tabBar.querySelector(`[data-tab="${next.id}"]`).focus();
      }, { signal });
      tabBar.appendChild(button);
    });

    function rows(holder, entries) {
      holder.replaceChildren();
      entries.forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'v16-kv-row';
        const key = document.createElement('span');
        key.className = 'v16-k';
        key.textContent = label;
        const val = document.createElement('span');
        val.className = 'v16-v';
        val.textContent = value;
        row.append(key, val);
        holder.append(row);
      });
    }

    function hero(bigEl, subEl, big, sub) {
      bigEl.textContent = big;
      subEl.textContent = sub;
    }

    /* ------------------------------ D-day ------------------------------ */

    const ddayDate = root.querySelector('#dc-dday-date');
    const ddayBig = root.querySelector('#dc-dday-out .dc-big');
    const ddaySub = root.querySelector('#dc-dday-out .dc-sub');
    const ddayRows = root.querySelector('#dc-dday-rows');

    function paintDday() {
      const date = parseISO(ddayDate.value);
      if (!date) {
        hero(ddayBig, ddaySub, 'D-day', '기준일을 고르세요');
        rows(ddayRows, []);
        return;
      }
      const delta = diffDays(todayDate, date);
      const label = delta === 0 ? 'D-day' : (delta > 0 ? `D-${delta}` : `D+${Math.abs(delta)}`);
      hero(ddayBig, ddaySub, label, delta === 0
        ? '오늘입니다'
        : (delta > 0 ? `${delta}일 남았습니다` : `${Math.abs(delta)}일 지났습니다`));
      const weekday = WEEKDAY_KO[date.getDay()];
      rows(ddayRows, [
        ['기준일', `${koreanLabel(date)}`],
        ['오늘', koreanLabel(todayDate)],
        ['지난 날', `${Math.abs(delta).toLocaleString('ko-KR')}일`],
        ['100일째', koreanLabel(addDays(date, 99))],
        ['1주년', koreanLabel(addMonths(date, 12))],
        ['주말 여부', (date.getDay() === 0 || date.getDay() === 6) ? `주말(${weekday})` : '평일'],
        ['공휴일 여부', isHoliday(date) ? '공휴일' : '아니요'],
      ]);
    }

    ddayDate.addEventListener('change', paintDday, { signal });
    ddayDate.addEventListener('input', paintDday, { signal });
    root.querySelector('#dc-dday-today').addEventListener('click', () => {
      ddayDate.value = todayISO;
      paintDday();
    }, { signal });
    root.querySelector('#dc-dday-plus100').addEventListener('click', () => {
      ddayDate.value = toISO(addDays(todayDate, 100));
      paintDday();
    }, { signal });

    /* ---------------------------- 날짜 더하기 ---------------------------- */

    const addDate = root.querySelector('#dc-add-date');
    const addDir = root.querySelector('#dc-add-dir');
    const addAmount = root.querySelector('#dc-add-amount');
    const addUnit = root.querySelector('#dc-add-unit');
    const addBig = root.querySelector('#dc-add-out .dc-big');
    const addSub = root.querySelector('#dc-add-out .dc-sub');
    const addRows = root.querySelector('#dc-add-rows');

    function paintAdd() {
      const start = parseISO(addDate.value);
      const amount = Math.floor(Number(addAmount.value) || 0);
      if (!start) {
        hero(addBig, addSub, '-', '시작 날짜를 고르세요');
        rows(addRows, []);
        return;
      }
      const direction = Number(addDir.value) === -1 ? -1 : 1;
      const total = direction * amount;
      let result;
      let detail;
      if (addUnit.value === 'month') {
        result = addMonths(start, total);
        detail = `${Math.abs(total)}개월 ${direction > 0 ? '뒤' : '전'}`;
      } else {
        const days = total * (addUnit.value === 'week' ? 7 : 1);
        result = addDays(start, days);
        detail = `${Math.abs(days)}일 ${direction > 0 ? '뒤' : '전'}`;
      }
      hero(addBig, addSub, toISO(result), `${WEEKDAY_KO[result.getDay()]}요일, ${detail}`);
      rows(addRows, [
        ['시작', koreanLabel(start)],
        ['계산', `${Math.abs(amount)}${addUnit.value === 'month' ? '개월' : (addUnit.value === 'week' ? '주' : '일')} ${direction > 0 ? '더하기' : '빼기'}`],
        ['결과', koreanLabel(result)],
        ['ISO', toISO(result)],
        ['공휴일 여부', isHoliday(result) ? '공휴일' : '아니요'],
      ]);
    }

    root.querySelector('#dc-add-run').addEventListener('click', paintAdd, { signal });
    [addDate, addAmount].forEach((el) => {
      el.addEventListener('change', paintAdd, { signal });
      el.addEventListener('input', paintAdd, { signal });
    });
    [addDir, addUnit].forEach((el) => el.addEventListener('change', paintAdd, { signal }));

    /* ----------------------------- 만 나이 ----------------------------- */

    const ageDate = root.querySelector('#dc-age-date');
    const ageBig = root.querySelector('#dc-age-out .dc-big');
    const ageSub = root.querySelector('#dc-age-out .dc-sub');
    const ageRows = root.querySelector('#dc-age-rows');

    function paintAge() {
      const birth = parseISO(ageDate.value);
      if (!birth) {
        hero(ageBig, ageSub, '-', '태어난 날을 고르세요');
        rows(ageRows, []);
        return;
      }
      if (diffDays(birth, todayDate) < 0) {
        hero(ageBig, ageSub, '-', '오늘보다 뒤의 날짜입니다');
        rows(ageRows, []);
        return;
      }
      let full = todayDate.getFullYear() - birth.getFullYear();
      const beforeBirthday = (todayDate.getMonth() < birth.getMonth())
        || (todayDate.getMonth() === birth.getMonth() && todayDate.getDate() < birth.getDate());
      if (beforeBirthday) full -= 1;
      const yearAge = todayDate.getFullYear() - birth.getFullYear();
      const lived = diffDays(birth, todayDate);
      let next = new Date(todayDate.getFullYear(), birth.getMonth(), birth.getDate());
      if (diffDays(todayDate, next) < 0) next = addMonths(next, 12);
      // 2월 29일 생일은 다음 해에 그 날이 없으면 3월 1일로 본다.
      if (next.getMonth() !== birth.getMonth() && birth.getMonth() === 1) {
        next = new Date(next.getFullYear(), 2, 1);
      }
      hero(ageBig, ageSub, `만 ${full}세`, `태어난 지 ${lived.toLocaleString('ko-KR')}일`);
      rows(ageRows, [
        ['태어난 날', koreanLabel(birth)],
        ['만 나이', `만 ${full}세`],
        ['연 나이', `${yearAge}세`],
        ['다음 생일', koreanLabel(next)],
        ['생일까지', `${diffDays(todayDate, next).toLocaleString('ko-KR')}일`],
        ['10000일', koreanLabel(addDays(birth, 9999))],
      ]);
    }

    ageDate.addEventListener('change', paintAge, { signal });
    ageDate.addEventListener('input', paintAge, { signal });
    root.querySelector('#dc-age-today').addEventListener('click', () => {
      ageDate.value = todayISO;
      paintAge();
    }, { signal });

    /* ------------------------------ 근무일 ------------------------------ */

    const workStart = root.querySelector('#dc-work-start');
    const workEnd = root.querySelector('#dc-work-end');
    const workBig = root.querySelector('#dc-work-out .dc-big');
    const workSub = root.querySelector('#dc-work-out .dc-sub');
    const workRows = root.querySelector('#dc-work-rows');

    function paintWork() {
      const start = parseISO(workStart.value);
      const end = parseISO(workEnd.value);
      if (!start || !end) {
        hero(workBig, workSub, '-', '기간을 정하세요');
        rows(workRows, []);
        return;
      }
      const result = businessDays(start, end);
      hero(workBig, workSub, `${result.business.toLocaleString('ko-KR')}일`,
        `${result.years[0]}~${result.years[result.years.length - 1]}년 기준`);
      const outside = result.years.filter((year) => !HOLIDAYS[year]);
      rows(workRows, [
        ['전체 날짜', `${result.days.toLocaleString('ko-KR')}일`],
        ['주말', `${result.weekend.toLocaleString('ko-KR')}일`],
        ['공휴일', `${result.holiday.toLocaleString('ko-KR')}일`],
        ['근무일', `${result.business.toLocaleString('ko-KR')}일`],
        ['반영한 해', result.years.join(', ')],
        ['공휴일 자료', outside.length
          ? `${outside.join(', ')}년은 자료가 없어 주말만 뺐습니다`
          : `${HOLIDAY_RANGE_LABEL} 공휴일 반영`],
      ]);
    }

    root.querySelector('#dc-work-run').addEventListener('click', paintWork, { signal });
    root.querySelector('#dc-work-month').addEventListener('click', () => {
      const first = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
      const last = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
      workStart.value = toISO(first);
      workEnd.value = toISO(last);
      paintWork();
    }, { signal });
    [workStart, workEnd].forEach((el) => {
      el.addEventListener('change', paintWork, { signal });
      el.addEventListener('input', paintWork, { signal });
    });

    selectTab('dday');
    return () => controller.abort();
  },
};

export default module;
