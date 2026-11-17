/* ============================================================
   今日课 CareToday · 原型交互
   纯 vanilla，无依赖。数据全部为合成示例。
   ============================================================ */

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

function goto(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------------- 屏 1：任务打卡 ---------------- */
let streak = 12;

$$('#tasklist .task').forEach((t) => {
  t.addEventListener('click', () => {
    const state = t.querySelector('.state');
    if (t.classList.contains('done')) {
      toast('已经打过卡了 · 想改可以长按删除');
      return;
    }
    t.classList.add('done');
    state.classList.add('done');
    state.textContent = t.dataset.task === 'med' ? '已服药' : '已完成';
    streak += 1;
    $('#streak-n').textContent = streak;
    toast('记下了 · 今天第 ' + streak + ' 天');
  });
});

/* ---------------- 屏 2：血压录入与判级 ---------------- */
const LEVELS = {
  red: {
    cls: 'red',
    tag: '需要处理',
    title: '血压偏高，已通知李护士',
    body: `<ul>
        <li>先坐下静坐 5 分钟，别说话，再测一次</li>
        <li>今天先别自己加药 —— 加药要王医生看过</li>
        <li>如果同时胸痛、说话不清、看东西模糊，立刻打 <b>120</b></li>
      </ul>`,
    foot: '已推送至 李静 的企微 · 承诺 15 分钟内回电 · 记录已留痕',
  },
  amber: {
    cls: 'warn',
    tag: '需要关注',
    title: '比目标高一点',
    body: `<ul>
        <li>今天晚饭少放盐，咸菜、酱菜先停一停</li>
        <li>明早同一时间再测一次，我看趋势</li>
        <li>如果连续 3 天都超过 160，我会提醒李护士</li>
      </ul>`,
    foot: '已记入趋势 · 暂不需要电话',
  },
  green: {
    cls: 'ok',
    tag: '已记录',
    title: '这一项完成了',
    body: `<ul>
        <li>在目标范围内（&lt; 140/90），继续保持</li>
        <li>今晚睡前记得吃阿托伐他汀</li>
      </ul>`,
    foot: '连续达标 12 天 · 下次测量：明天 7:30',
  },
};

function judge(sbp, dbp) {
  // 在管患者阈值较诊室诊断阈值下移：≥175/105 即触发红灯
  if (sbp >= 175 || dbp >= 105) return 'red';
  if (sbp < 90 || dbp < 60) return 'red';
  if (sbp >= 150 || dbp >= 95) return 'amber';
  if (sbp >= 140 || dbp >= 90) return 'amber';
  return 'green';
}

function submitBP() {
  const sbp = parseInt($('#in-sbp').value, 10);
  const dbp = parseInt($('#in-dbp').value, 10);
  const out = $('#bp-result');

  if (!sbp || !dbp || sbp < 40 || dbp < 20) {
    toast('先填一下两个数字');
    return;
  }

  const lv = judge(sbp, dbp);
  const cfg = LEVELS[lv];

  out.innerHTML = `
    <div class="result-card ${cfg.cls}">
      <div class="rc-head">
        <span class="rc-tag">${cfg.tag}</span>
        <span class="rc-t">${cfg.title}</span>
      </div>
      <div class="rc-body">
        <div style="font-size:12px;color:#8c8478;margin-bottom:6px">
          本次记录 <b style="font-size:15px;color:#2a2724">${sbp}/${dbp}</b> mmHg · 07:3${Math.floor(Math.random() * 9)}
        </div>
        ${cfg.body}
      </div>
      <div class="rc-foot">${cfg.foot}</div>
    </div>`;

  if (lv === 'red') {
    // 红灯：把今天的血压任务从「已完成」改成「需要处理」，并在今天页露出
    const task = document.querySelector('.task[data-task="bp"]');
    const st = task.querySelector('.state');
    st.classList.remove('done');
    st.classList.add('warn');
    st.textContent = sbp + '/' + dbp + ' 待回访';
    toast('已通知李护士 · 她会给你回电');
  } else if (lv === 'green') {
    toast('记好了 · 连续达标多一天');
  }
  const sc = out.closest('.scroll');
  if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
}

/* ---------------- 屏 3：指标与图表 ---------------- */
const SERIES = {
  bp: {
    unit: 'mmHg · 今早',
    latest: '138/86',
    delta: '↓ 4',
    stats: ['140/85', '178/108', '73%'],
    line: [143, 146, 138, 136, 139, 141, 137, 135, 138, 140, 142, 145, 139, 136, 134, 133, 137, 140, 143, 178, 146, 139, 135, 133, 131, 130, 134, 137, 133, 138],
    low: [85, 88, 82, 80, 84, 86, 81, 79, 82, 84, 86, 89, 83, 80, 78, 77, 81, 84, 87, 108, 90, 83, 79, 77, 75, 74, 78, 81, 77, 86],
    target: 140,
    fmt: (v) => v,
    recs: [
      ['11/14 07:20', '138/86', '手动'],
      ['11/13 07:15', '137/81', '设备'],
      ['11/12 07:40', '139/83', '手动'],
      ['10/28 20:10', '178/108', '手动', true],
      ['10/27 07:05', '149/91', '手动'],
    ],
  },
  glu: {
    unit: 'mmol/L · 空腹',
    latest: '6.8',
    delta: '↓ 0.6',
    stats: ['7.1', '9.4', '63%'],
    line: [8.4, 8.1, 7.9, 8.2, 7.8, 7.5, 7.9, 7.6, 6.9, 7.2, 6.8, 6.5, 6.9, 6.9, 6.6, 6.4, 6.7, 7.0, 6.6, 9.4, 7.2, 6.6, 6.4, 6.2, 6.0, 6.5, 6.3, 6.1, 6.4, 6.8],
    low: null,
    target: 7.0,
    fmt: (v) => v.toFixed(1),
    recs: [
      ['11/14 06:50', '6.8', '手动'],
      ['11/13 06:45', '7.1', '手动'],
      ['11/11 06:50', '6.9', '设备'],
      ['11/06 06:40', '9.4', '手动', true],
      ['11/05 06:55', '7.6', '手动'],
    ],
  },
  wt: {
    unit: 'kg · 晨起',
    latest: '67.2',
    delta: '↓ 0.4',
    stats: ['67.6', '68.9', '—'],
    line: [68.9, 68.8, 68.7, 68.6, 68.6, 68.4, 68.5, 68.3, 68.2, 68.4, 68.1, 68.0, 68.1, 67.9, 67.8, 67.8, 67.6, 67.7, 67.5, 67.6, 67.4, 67.5, 67.3, 67.4, 67.2, 67.3, 67.1, 67.2, 67.3, 67.2],
    low: null,
    target: 66.0,
    fmt: (v) => v.toFixed(1),
    recs: [
      ['11/14 06:30', '67.2', '手动'],
      ['11/10 06:30', '67.5', '手动'],
      ['11/05 06:35', '67.8', '手动'],
      ['10/30 06:30', '68.3', '手动'],
      ['10/25 06:30', '68.6', '手动'],
    ],
  },
};

function drawChart(svg, data, opts) {
  opts = opts || {};
  const W = opts.w || 320, H = opts.h || 150;
  const padL = 26, padR = 12, padT = 14, padB = 20;
  const pts = data.line;
  const all = data.low ? pts.concat(data.low) : pts.slice();
  let min = Math.min(...all), max = Math.max(...all);
  const span = Math.max(max - min, 1);
  min -= span * 0.18;
  max += span * 0.18;

  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let inner = '';

  // 网格
  for (let g = 0; g <= 3; g++) {
    const yy = padT + (g / 3) * (H - padT - padB);
    inner += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#ede7dc" stroke-width="1"/>`;
  }
  // 目标线
  if (data.target) {
    inner += `<line x1="${padL}" y1="${y(data.target)}" x2="${W - padR}" y2="${y(data.target)}"
      stroke="#c9a227" stroke-width="1" stroke-dasharray="4 3" opacity=".8"/>`;
    if (!opts.compact) {
      inner += `<text class="axis-label" x="${padL + 8}" y="${padT + 7}" style="fill:#a98a1e">- - 目标 ${data.target}</text>`;
    }
  }
  // 面积：高压线与低压线之间的淡带
  if (data.low) {
    const lineD = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const lowD = data.low.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    inner += `<path d="M${lineD.join(' L')} L${lowD.slice().reverse().join(' L')} Z" fill="#2f5a4a" opacity=".07"/>`;
    inner += `<path d="M${lowD.join(' L')}" fill="none" stroke="#8fa89a" stroke-width="1.2" stroke-dasharray="3 2"/>`;
  }
  inner += `<path d="${path}" fill="none" stroke="#2f5a4a" stroke-width="1.8" stroke-linejoin="round"/>`;

  // 超限点：只画点，不逐个标数（避免标签互相压住）
  let peak = -Infinity, peakIdx = -1;
  pts.forEach((v, i) => {
    if (v > peak) { peak = v; peakIdx = i; }
    if (data.target && v > data.target) {
      inner += `<circle cx="${x(i)}" cy="${y(v)}" r="2.4" fill="#b4453a"/>`;
    }
  });
  if (data.target && peak > data.target && !opts.compact) {
    // 标签向内收 26px，避免峰值落在首/末点时被图框裁掉
    let tx = x(peakIdx);
    if (tx > W - padR - 30) tx -= 28;
    else if (tx < padL + 30) tx += 28;
    inner += `<text class="axis-label" x="${tx}" y="${y(peak) - 8}" text-anchor="middle" style="fill:#b4453a">${data.fmt(peak)}</text>`;
  }
  // 末点
  const li = pts.length - 1;
  inner += `<circle cx="${x(li)}" cy="${y(pts[li])}" r="3.6" fill="#2f5a4a"/>`;
  inner += `<circle cx="${x(li)}" cy="${y(pts[li])}" r="7" fill="none" stroke="#2f5a4a" stroke-width="1" opacity=".3"/>`;

  // y 轴刻度：标真实数据上下界（不是加过 padding 的假边界，否则 55 会让人以为血压到过 55）
  if (!opts.compact) {
    const realMax = Math.max(...all), realMin = Math.min(...all);
    inner += `<text class="axis-label" x="2" y="${y(realMax) + 6}">${data.fmt ? data.fmt(realMax) : Math.round(realMax)}</text>`;
    inner += `<text class="axis-label" x="2" y="${y(realMin) - 2}">${data.fmt ? data.fmt(realMin) : Math.round(realMin)}</text>`;
  }
  // x 轴
  inner += `<text class="axis-label" x="${padL}" y="${H - 3}">${opts.xl || '30 天前'}</text>`;
  inner += `<text class="axis-label" x="${W - padR}" y="${H - 3}" text-anchor="end">${opts.xr || '今天'}</text>`;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = inner;
}

function renderMetric(key) {
  const d = SERIES[key];
  $('#mv').textContent = d.latest;
  $('#mu').textContent = d.unit;
  $('#md').textContent = d.delta;
  $('#s-avg').textContent = d.stats[0];
  $('#s-max').textContent = d.stats[1];
  $('#s-rate').textContent = d.stats[2];
  drawChart($('#chart'), d);

  const list = $('#rec-list');
  list.innerHTML = d.recs
    .map(
      (r) => `<div class="rec">
        <span class="when">${r[0]}</span>
        <span class="val">${r[1]}</span>
        ${r[3] ? '<span class="flag">超限</span>' : ''}
        <span class="src">${r[2]}</span>
      </div>`
    )
    .join('');
}

$$('#metric-seg button').forEach((b) => {
  b.addEventListener('click', () => {
    $$('#metric-seg button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    renderMetric(b.dataset.m);
  });
});

/* 首页迷你折线 */
(function initSpark() {
  const svg = document.querySelector('#mini-spark');
  if (!svg) return;
  const d = SERIES.bp;
  // 只画高压单线：14 点足以露出 10/28 那次 178 的尖峰
  drawChart(
    svg,
    { line: d.line.slice(-14), target: 140, fmt: (v) => v },
    { h: 92, w: 300, xl: '2 周前', xr: '今天', compact: true }
  );
})();

/* ---------------- 屏 4：复诊 ---------------- */
function bookVisit() {
  toast('已进入预约：11/20 周四 上午 · 王立群 医生');
  setTimeout(() => toast('预约成功 · 记得带医保卡和这 30 天的记录'), 2400);
}

/* ---------------- 屏 5：报告解读 ---------------- */
function runOCR() {
  const zone = $('#upload-zone');
  const t = $('#up-t'), s = $('#up-s');
  const out = $('#report-out');
  if (zone.dataset.busy) return;

  zone.dataset.busy = '1';
  t.textContent = '正在识别…';
  s.textContent = '抽指标、对参考区间、和上次比';
  out.innerHTML = '';

  setTimeout(() => {
    t.textContent = '识别完成 · 3 项超参考区间';
    s.textContent = '点这里可以再传一张';
    zone.dataset.busy = '';
    out.innerHTML = `
      <div class="report-item">
        <div class="rh"><span>生化 + 糖化 · 11/14</span><span>城南社区检验科</span></div>
        <div class="ri"><span class="k">糖化血红蛋白 HbA1c</span><span class="v up">7.8<span class="ref">% · 参考 4.0–6.0</span></span></div>
        <div class="ri"><span class="k">空腹血糖</span><span class="v up">7.2<span class="ref">mmol/L · 参考 3.9–6.1</span></span></div>
        <div class="ri"><span class="k">低密度脂蛋白 LDL-C</span><span class="v up">3.1<span class="ref">mmol/L · 参考 &lt; 3.4（你的目标 &lt; 1.8）</span></span></div>
        <div class="ri"><span class="k">肌酐</span><span class="v">68<span class="ref">μmol/L · 参考 41–81</span></span></div>
        <div class="ri"><span class="k">尿微量白蛋白/肌酐</span><span class="v">22<span class="ref">mg/g · 参考 &lt; 30</span></span></div>
      </div>

      <div class="ai-note">
        <div class="who">AI 管家 · 解读草稿</div>
        <p>这次的糖化血红蛋白 <b>7.8%</b>，比三个月前的 <b>8.2%</b> 降了 0.4，方向是对的，但还没到 7.0 以下。
        这个数反映的是你最近三个月的平均血糖，不是某一天吃多了。</p>
        <ul>
          <li>晚饭主食可以再减三分之一，先减米饭，别减菜</li>
          <li>低密度脂蛋白 3.1，对你这情况目标应该是 1.8 以下，他汀别停</li>
          <li>肾功能两项都正常，这条是好消息</li>
        </ul>
      </div>

      <div class="status-line" id="confirm-line">
        <span class="pip"></span>
        <span>解读草稿已提交 <strong>王立群 医生</strong> 审核 · 通常 2 小时内</span>
      </div>
      <button class="btn-ghost" onclick="confirmByDoctor()">模拟：医生在后台点了「确认」</button>
    `;
  }, 1200);
}

function confirmByDoctor() {
  const line = $('#confirm-line');
  if (!line) return;
  line.classList.add('confirmed');
  line.innerHTML = `<span class="pip"></span><span>已由 <strong>王立群 医生</strong> 审核 · 11/14 11:20</span>`;
  const note = document.querySelector('.ai-note .who');
  if (note) note.textContent = 'AI 管家 · 解读（王医生已审核）';
  toast('医生确认后，这段解读才对你可见');
}

/* ---------------- 屏 6：AI 对话 ---------------- */
const BLOCK_DRUG = /停药|停掉|不吃了|能不能停|减量|加量|换药|改药|吃什么药|剂量|吃几片|副作用大不大/;
const BLOCK_EMERG = /胸痛|胸闷|呼吸困难|喘不上|昏迷|晕倒|说不出话|嘴歪|一侧没劲|急救|120|大出血/;
const KB = [
  {
    re: /他汀|阿托伐他汀|晚上吃|睡前/,
    a: `阿托伐他汀一般建议<b>晚上吃</b>。身体合成胆固醇主要在夜里，晚上吃降得更到位。<br><br>不过比"几点吃"更重要的是<b>每天同一时间</b>——你今天早上明天晚上，效果会打折。`,
    src: '来源：本院《他汀类药物用药指导》· 已由王医生审核',
  },
  {
    re: /178|180|血压.*(高|升)|高.*血压|头晕/,
    a: `先别慌，按这三步：<br>1. 坐下静坐 5 分钟，别说话，重新测一次<br>2. 还是 180 以上，<b>别自己加药</b><br>3. 我已经通知李护士了，她 15 分钟内给你回电<br><br>要是同时有胸痛、说话不清、看东西模糊，直接打 <b>120</b>。`,
    src: '触发规则：收缩压 ≥ 180 · 已生成预警工单',
  },
  {
    re: /复诊|挂号|预约|什么时候去|续方/,
    a: `阿托伐他汀还剩 <b>6 天</b>。王立群医生最近的号是 <b>11 月 20 日（周四）上午</b>。<br><br>去「用药」那页点"预约复诊"就能约，记得带医保卡。`,
    src: '来源：你的用药记录 + 本院排班',
  },
  {
    re: /血糖|糖化|糖尿病|主食|米饭/,
    a: `你最近三个月平均血糖是 <b>7.8%</b>（糖化血红蛋白），比上次降了 0.4。<br><br>能立刻做的：晚饭主食减三分之一，先减米饭不加菜；饭后走 20 分钟。这两件对餐后血糖最直接。`,
    src: '来源：11/14 检验报告 · 王医生已审核',
  },
];

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function pushBubble(html, cls) {
  const chat = $('#chat');
  const div = document.createElement('div');
  div.className = 'bubble ' + cls;
  div.innerHTML = html;
  chat.appendChild(div);
  const sc = chat.closest('.scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
  return div;
}

function ask(q) {
  const input = $('#chat-in');
  if (input) input.value = '';
  pushBubble(q, 'me');

  setTimeout(() => {
    if (BLOCK_EMERG.test(q)) {
      pushBubble(
        `<div class="ttl">这不是能在这儿问的事</div>
         现在<b>立刻打 120</b>，或者让身边的人打。<br><br>
         坐下或半躺，别自己走动，别自己开车去医院。把门打开等急救。<br><br>
         电话里说清楚：哪里不舒服、几分钟前开始的、有没有高血压糖尿病。
         <span class="src">已同时通知 李静（责任护士）· 事件已记录</span>`,
        'block'
      );
      return;
    }
    if (BLOCK_DRUG.test(q)) {
      pushBubble(
        `<div class="ttl">这个我不替你决定</div>
         停药、减量、换药，都得王医生看过你最近的记录才能定。我把这句话转给李护士了，她今天会联系你。<br><br>
         在那之前：<b>别自己停，也别自己加</b>。降压药突然停，血压会反弹得比原来更高。
         <span class="src">已转人工 · 工单 #2026-1114-037</span>`,
        'block'
      );
      return;
    }
    const hit = KB.find((k) => k.re.test(q));
    if (hit) {
      pushBubble(`${hit.a}<span class="src">${hit.src}</span>`, 'ai');
      return;
    }
    pushBubble(
      `这个我得查一下，或者让李护士回你更准。<br><br>
       你也可以换个问法：药怎么吃、报告上的数字什么意思、哪天该复查。
       <span class="src">已记录，护士上班后会看</span>`,
      'ai'
    );
  }, 420);
}

function sendChat() {
  const input = $('#chat-in');
  const v = input.value.trim();
  if (!v) {
    toast('先说一句');
    return;
  }
  ask(v);
}

/* ============================================================
   医护工作台
   ============================================================ */
const QUEUE = [
  {
    id: 'p1', name: '张桂芳', age: 68, sex: '女', tier: 'red', lamp: 'red',
    why: '10/28 178/108，复测 142/88，待回访确认', tm: '09:12', tag: '红灯',
    cond: '高血压 2 级（很高危）· 2 型糖尿病', days: 87, nurse: '李静', dr: '王立群',
    vitals: [['血压', '138/86', ''], ['空腹血糖', '6.8', ''], ['依从', '82%', ''], ['风险分', '0.71', 'red']],
    note: '近 30 天 1 次红灯（10/28）、5 次漏服集中在周末晚。糖化 8.2→7.8，趋势向下但未达标。他汀剩 6 天，续方是本周最关键的转化点。',
    ev: [
      ['11/14 07:20', '<b>血压 138/86</b> 手动录入 · 达标'],
      ['11/14 09:02', '上传化验单 <b>糖化 7.8%</b> · AI 解读待审'],
      ['10/28 20:10', '血压 <em>178/108</em> 触发红灯'],
      ['10/28 20:26', '李静 电话回访 · 复测 142/88 · 已排除急症'],
      ['10/12 10:00', '门诊复诊 · 王立群 · 维持原方案'],
    ],
  },
  {
    id: 'p2', name: '陈国强', age: 71, sex: '男', tier: 'red', lamp: 'red',
    why: '今早 182/104，未复测', tm: '08:40', tag: '红灯',
    cond: '高血压 3 级 · 冠心病（支架术后 2 年）', days: 214, nurse: '李静', dr: '王立群',
    vitals: [['血压', '182/104', 'red'], ['心率', '88', ''], ['依从', '64%', ''], ['风险分', '0.86', 'red']],
    note: '支架术后，血压连续 3 天走高。自述"最近睡得晚、咸菜吃得多"。依从性下滑，需要医生评估是否调整方案——注意：这一步只能由医生做。',
    ev: [
      ['11/14 08:12', '血压 <em>182/104</em> · 未复测'],
      ['11/13 07:50', '血压 176/98'],
      ['11/12 08:05', '血压 172/96 · 已提醒'],
      ['11/10 09:30', '随访：自述睡眠差、口味偏咸'],
    ],
  },
  {
    id: 'p3', name: '刘桂英', age: 63, sex: '女', tier: 'red', lamp: 'red',
    why: '空腹血糖 15.6，自述停药 4 天', tm: '08:22', tag: '红灯',
    cond: '2 型糖尿病 · 糖尿病肾病 3 期', days: 156, nurse: '李静', dr: '王立群',
    vitals: [['空腹血糖', '15.6', 'red'], ['血压', '146/88', ''], ['依从', '41%', ''], ['风险分', '0.91', 'red']],
    note: '自行停用二甲双胍 4 天，原因"听说伤肾"。这是典型的信息误导导致停药，需要一次 15 分钟的用药教育 + 医生复核肾功能。',
    ev: [
      ['11/14 08:05', '空腹血糖 <em>15.6</em>'],
      ['11/14 08:22', '自述已停药 4 天（听说伤肾）'],
      ['11/10 06:50', '空腹血糖 12.4'],
      ['11/04 10:00', '复诊 · 肌酐正常 · 维持方案'],
    ],
  },
  {
    id: 'p4', name: '周建华', age: 59, sex: '男', tier: 'yellow', lamp: 'amber',
    why: '逾期随访 11 天 · 电话未接 2 次', tm: '—', tag: '逾期',
    cond: '高血压 1 级 · 高脂血症', days: 63, nurse: '李静', dr: '张敏',
    vitals: [['血压', '—', ''], ['低密度脂蛋白', '4.2', 'red'], ['依从', '48%', ''], ['风险分', '0.54', '']],
    note: '首月热情期过后明显掉线，最后互动是 11/03。家属联系人（女儿）电话可用，建议改走家属通道。',
    ev: [
      ['11/12 15:00', '第 2 次电话未接'],
      ['11/07 10:20', '第 1 次电话未接'],
      ['11/03 21:10', '打卡：血压 148/92'],
    ],
  },
  {
    id: 'p5', name: '王秀兰', age: 74, sex: '女', tier: 'yellow', lamp: 'amber',
    why: '连续 5 天未打卡 · 上次互动 11/09', tm: '—', tag: '未打卡',
    cond: '2 型糖尿病 · 骨质疏松', days: 132, nurse: '李静', dr: '张敏',
    vitals: [['空腹血糖', '8.9', ''], ['体重', '52.1', ''], ['依从', '69%', ''], ['风险分', '0.47', '']],
    note: '独居，子女在外地。此前打卡很规律，突然中断更像"不会用"而不是"不想做"，优先打一次电话确认。',
    ev: [
      ['11/09 07:30', '最后一次打卡 · 血糖 8.9'],
      ['11/08 07:20', '打卡 · 血糖 8.4'],
      ['11/02 10:00', '随访：反映手机字太小'],
    ],
  },
  {
    id: 'p6', name: '赵德海', age: 66, sex: '男', tier: 'green', lamp: 'gray',
    why: '到期复诊 11/18 · 需确认时段', tm: '—', tag: '复诊',
    cond: '高血压 2 级 · 稳定期', days: 301, nurse: '李静', dr: '王立群',
    vitals: [['血压', '132/80', ''], ['依从', '91%', ''], ['达标率', '88%', ''], ['风险分', '0.21', '']],
    note: '一年稳定，可作为"绿标样板"用于社群运营。复诊按 3 个月周期，本次只需常规复查，无需额外干预。',
    ev: [
      ['11/14 07:00', '血压 132/80 · 连续达标 26 天'],
      ['10/20 07:10', '血压 130/78'],
      ['09/18 10:00', '复诊 · 维持方案'],
    ],
  },
];

let activeId = 'p1';

function renderQueue() {
  const box = $('#queue');
  box.innerHTML = QUEUE.map(
    (p) => `<div class="qitem ${p.id === activeId ? 'on' : ''}" data-id="${p.id}">
      <span class="lamp ${p.lamp}"></span>
      <div style="flex:1;min-width:0">
        <div class="who">${p.name} <span style="font-weight:400;color:#8c8478;font-size:11.5px">${p.sex} ${p.age}</span></div>
        <div class="why">${p.why}</div>
      </div>
      <span class="kk">${p.tag}</span>
      <span class="tm">${p.tm}</span>
    </div>`
  ).join('');

  $$('#queue .qitem').forEach((el) =>
    el.addEventListener('click', () => {
      activeId = el.dataset.id;
      renderQueue();
      renderDetail();
    })
  );
  $('#nav-todo').textContent = 41 + QUEUE.length;
}

function renderDetail() {
  const p = QUEUE.find((x) => x.id === activeId) || QUEUE[0];
  if (!p) return;
  const detail = $('#wb-detail');
  detail.innerHTML = `
    <div class="d-head">
      <div class="av serif">${p.name.slice(-1)}</div>
      <div>
        <div class="nm">${p.name}</div>
        <div class="sub">${p.sex} ${p.age} 岁 · ${p.cond} · 在管 ${p.days} 天</div>
      </div>
      <div class="acts">
        <button class="btn-sm">打电话</button>
        <button class="btn-sm">发企微</button>
        <button class="btn-sm primary" onclick="closeItem()">记录随访</button>
      </div>
    </div>

    <div class="d-section">
      <h4>当前状态</h4>
      <div class="vitals">
        ${p.vitals
          .map(
            (v) => `<div class="v">
              <div class="k">${v[0]}</div>
              <div class="n ${v[2] === 'red' ? 'red' : ''}">${v[1]}</div>
            </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="d-section">
      <h4>AI 摘要（供参考 · 不替代判断）</h4>
      <div class="ai-summary">
        <div class="lb">基于近 30 天记录生成</div>
        <p>${p.note}</p>
      </div>
    </div>

    <div class="d-section">
      <h4>30 天轨迹</h4>
      <div class="mini-chart"><svg id="mini-chart" style="width:100%;display:block"></svg></div>
    </div>

    <div class="d-section">
      <h4>最近事件</h4>
      <div class="trace">
        ${p.ev
          .map(
            (e) => `<div class="ev"><span class="t">${e[0]}</span><span class="x">${e[1]}</span></div>`
          )
          .join('')}
      </div>
    </div>

    <div class="d-section">
      <h4>本次随访记录</h4>
      <div class="follow-form">
        <select><option>已联系</option><option>未接</option><option>拒访</option><option>已复诊</option><option>已转医生</option></select>
        <select><option>企微</option><option>电话</option><option>短信</option><option>家属</option></select>
        <textarea placeholder="一句话记下他说了什么（可语音转写）">自述最近睡得晚、口味偏咸，已提醒低盐；答应明早复测。</textarea>
        <div class="row-actions">
          <button class="btn-sm primary" onclick="closeItem()">保存并关闭</button>
          <button class="btn-sm" onclick="toast('已标记为需医生复核 · 不改变红灯状态')">转医生复核</button>
          <span class="hintx">红灯只能升级，不能静默关闭</span>
        </div>
      </div>
    </div>
  `;

  const svg = $('#mini-chart');
  if (svg) {
    // 每位患者一条自己的轨迹，末点对齐"当前状态"里的血压，避免图文互相打脸
    const [sbp, dbp] = String((p.vitals[0] && p.vitals[0][1]) || '138/86')
      .split('/')
      .map((n) => parseFloat(n));
    const line = SERIES.bp.line.slice();
    const low = SERIES.bp.low.slice();
    const n = line.length;
    if (!isNaN(sbp)) {
      line[n - 1] = sbp;
      line[n - 2] = Math.round((line[n - 2] + sbp) / 2);
    }
    if (!isNaN(dbp)) {
      low[n - 1] = dbp;
      low[n - 2] = Math.round((low[n - 2] + dbp) / 2);
    }
    drawChart(svg, { line, low, target: 140, fmt: (v) => v, w: 640, h: 132 });
  }
}

function closeItem() {
  const i = QUEUE.findIndex((x) => x.id === activeId);
  if (i < 0) return;
  const p = QUEUE[i];
  QUEUE.splice(i, 1);
  if (p.tier === 'red') {
    toast('已记录 · 红灯转「已处置待观察」，未关闭');
  } else {
    toast('已记录 · 移出今日待办');
  }
  activeId = QUEUE.length ? QUEUE[0].id : null;
  renderQueue();
  if (activeId) renderDetail();
  else $('#wb-detail').innerHTML = '<div style="padding:80px 0;text-align:center;color:#8c8478">今日待办已清空</div>';
}

/* ---------------- 通用小交互 ---------------- */
function pickSeg(btn) {
  const box = btn.parentNode;
  Array.from(box.children).forEach((b) => b.classList.remove('on'));
  btn.classList.add('on');
}

function toggleSym(btn) {
  const box = btn.parentNode;
  const none = box.querySelector('.pick.on');
  if (btn.textContent.trim() === '都没有') {
    Array.from(box.children).forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    return;
  }
  if (none && none.textContent.trim() === '都没有') none.classList.remove('on');
  btn.classList.toggle('on');
}

/* ---------------- 血糖打卡 ---------------- */
function submitGlu() {
  const v = parseFloat($('#glu-in').value);
  const out = $('#glu-out');
  const seg = ($('#glu-seg .on') || {}).textContent || '空腹';
  const fasting = seg.trim() === '空腹';

  if (!v || v <= 0 || v > 40) {
    toast('先填一个血糖值');
    return;
  }

  let lv = 'green';
  if (v < 3.9) lv = 'red';
  else if (fasting && v >= 13.9) lv = 'red';
  else if (!fasting && v >= 16.7) lv = 'red';
  else if (fasting && v >= 10.0) lv = 'amber';
  else if (!fasting && v >= 13.9) lv = 'amber';
  else if (fasting && v > 7.0) lv = 'amber';
  else if (!fasting && v > 10.0) lv = 'amber';

  const M = {
    red: {
      cls: 'red',
      tag: '需要处理',
      t: v < 3.9 ? '低了，现在先吃 15 克糖' : '血糖偏高，已通知李护士',
      li:
        v < 3.9
          ? ['马上吃 3 块方糖或喝半杯果汁，15 分钟后复测', '别等，低血糖拖不得', '复测还低于 3.9，让家人打 120']
          : ['先喝一杯温水，坐下休息 10 分钟复测', '今天别再吃水果和粥', '如果口干、恶心、呼吸有烂苹果味，立刻打 120'],
      foot: '已推送至 李静 的企微 · 承诺 15 分钟内回电',
    },
    amber: {
      cls: 'warn',
      tag: '需要关注',
      t: '比目标高一点',
      li: ['今晚主食减三分之一，先减米饭', '明早同一时间再测一次', '连续 3 天超过 10，我会提醒李护士'],
      foot: '已记入趋势 · 暂不需要电话',
    },
    green: {
      cls: 'ok',
      tag: '已记录',
      t: '这一项完成了',
      li: [`在目标范围内（${fasting ? '4.4–7.0' : '< 10.0'}），继续保持`, '饭后走 20 分钟，血糖会更稳'],
      foot: '连续达标 9 天 · 下次测量：明天 7:30',
    },
  };
  const c = M[lv];

  out.innerHTML = `
    <div class="result-card ${c.cls}">
      <div class="rc-head"><span class="rc-tag">${c.tag}</span><span class="rc-t">${c.t}</span></div>
      <div class="rc-body">
        <div style="font-size:12px;color:#8c8478;margin-bottom:6px">
          本次记录 <b style="font-size:15px;color:#2a2724">${v.toFixed(1)}</b> mmol/L · ${seg.trim()}
        </div>
        <ul>${c.li.map((x) => `<li>${x}</li>`).join('')}</ul>
      </div>
      <div class="rc-foot">${c.foot}</div>
    </div>`;

  const sc = out.closest('.scroll');
  if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  if (lv === 'red') toast('已通知李护士 · 她会给你回电');
  else if (lv === 'green') toast('记好了 · 连续达标多一天');
}

/* ---------------- 体重与症状 ---------------- */
function submitWeight() {
  const w = parseFloat($('#wt-in').value);
  const out = $('#wt-out');
  if (!w || w < 20 || w > 250) {
    toast('先填一个体重');
    return;
  }
  const picked = Array.from($$('#symptom-picks .pick.on')).map((b) => b.textContent.trim());
  const acute = picked.includes('夜里憋醒') || picked.includes('躺平就喘');

  let lv = 'green';
  if (acute) lv = 'red';
  else if (picked.includes('脚踝水肿')) lv = 'amber';

  const M = {
    red: {
      cls: 'red',
      tag: '需要处理',
      t: '这个情况今天要找医生',
      li: ['先坐起来，双腿下垂，别平躺', '今天的水少喝一点，盐再少一点', '已经通知李护士，她会打给你'],
      foot: '心衰加重的信号 · 已推 李静 企微 · 15 分钟内回电',
    },
    amber: {
      cls: 'warn',
      tag: '需要关注',
      t: '记下了，先观察',
      li: ['今晚把脚垫高一点睡觉', '明早称一次，如果又涨 0.5kg 以上，一定告诉我', '盐再少一点，腌菜先别吃'],
      foot: '已记入趋势 · 明天这个时间我再问你',
    },
    green: {
      cls: 'ok',
      tag: '已记录',
      t: '这一项完成了',
      li: ['7 天涨 0.4kg，还在安全区（< 2kg）', '保持同样时间、同样衣服称'],
      foot: '连续记录 87 天 · 下次：明天 7:40',
    },
  };
  const c = M[lv];

  out.innerHTML = `
    <div class="result-card ${c.cls}">
      <div class="rc-head"><span class="rc-tag">${c.tag}</span><span class="rc-t">${c.t}</span></div>
      <div class="rc-body">
        <div style="font-size:12px;color:#8c8478;margin-bottom:6px">
          本次记录 <b style="font-size:15px;color:#2a2724">${w.toFixed(1)}</b> kg · 上周 68.0
        </div>
        <ul>${c.li.map((x) => `<li>${x}</li>`).join('')}</ul>
      </div>
      <div class="rc-foot">${c.foot}</div>
    </div>`;

  const sc = out.closest('.scroll');
  if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  toast(lv === 'red' ? '已通知李护士 · 心衰信号不等人' : lv === 'amber' ? '记下了 · 明天我再问你' : '记好了');
}

/* ---------------- 复诊 ---------------- */
function pickSlot(btn) {
  if (btn.classList.contains('full')) return;
  Array.from($('#slots').children).forEach((b) => b.classList.remove('on'));
  btn.classList.add('on');
  const b = btn.closest('.scroll').querySelector('.btn-primary');
  if (b) b.textContent = `确认 ${btn.textContent.trim()} 的号`;
}

function confirmVisit() {
  const s = ($('#slots .slot.on') || {}).textContent || '';
  if (!s) {
    toast('先选一个时段');
    return;
  }
  toast(`已约 11/20 周四 ${s} · 王立群 医生`);
  $('#visit-hint').innerHTML =
    `已确认。<b>11/20 周四 ${s}</b>，城南中心 2 楼 3 诊室。前一天晚上会再提醒你一次，当天带医保卡就行 —— 记录我已经打包好了。`;
  const sc = $('#visit-hint').closest('.scroll');
  if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  setTimeout(() => toast('已加入日历 · 会提前 1 天提醒'), 2400);
}

/* ---------------- 工作台：四张视图 ---------------- */
const PATIENTS = [
  ['张桂芳', '女 68', '高血压 · 糖尿病', 'amber', '73%', '今天 07:34', '李静'],
  ['陈国强', '男 71', '高血压 3 级 · 冠心病', 'red', '64%', '今天 08:12', '李静'],
  ['刘桂英', '女 63', '2 型糖尿病', 'red', '41%', '今天 08:22', '李静'],
  ['周建华', '男 59', '高血压 · 血脂异常', 'amber', '52%', '11/03', '王芳'],
  ['王秀兰', '女 74', '高血压 · 心衰', 'amber', '38%', '11/09', '王芳'],
  ['赵德海', '男 66', '2 型糖尿病', 'green', '91%', '今天 06:50', '李静'],
  ['孙玉梅', '女 70', '高血压', 'green', '88%', '今天 07:02', '王芳'],
  ['李长海', '男 62', '慢阻肺', 'green', '79%', '今天 07:20', '李静'],
  ['吴桂香', '女 77', '高血压 · 糖尿病', 'amber', '56%', '11/11', '王芳'],
  ['马国强', '男 68', '冠心病 · 血脂异常', 'green', '84%', '今天 06:40', '李静'],
  ['朱凤兰', '女 65', '2 型糖尿病', 'red', '33%', '今天 08:40', '王芳'],
  ['郑金山', '男 72', '高血压 · 心衰', 'green', '81%', '今天 07:15', '李静'],
];

const REPORTS = [
  ['朱凤兰', '11/14', '生化 + 糖化', 'HbA1c 9.1 · LDL 3.8', '待审核', 'red'],
  ['张桂芳', '11/14', '生化 + 糖化', 'HbA1c 7.8 · LDL 3.1', '待审核', 'amber'],
  ['陈国强', '11/13', '心肌酶 + 肝肾', '肌酐 118（上限 111）', '待审核', 'red'],
  ['刘桂英', '11/13', '糖化 + 尿微量', 'HbA1c 10.2 · UACR 42', '待审核', 'red'],
  ['吴桂香', '11/12', '血脂全套', 'LDL 2.9（已达目标）', '待审核', 'green'],
  ['马国强', '11/12', '凝血 + 肝肾', '全部在参考范围', '待审核', 'green'],
  ['王秀兰', '11/11', 'BNP + 电解质', 'BNP 620（明显升高）', '待审核', 'red'],
  ['孙玉梅', '11/11', '生化', '钾 3.3（偏低）', '待审核', 'amber'],
  ['赵德海', '11/10', '糖化', 'HbA1c 6.4（达标）', '待审核', 'green'],
];

function wbView(name) {
  $$('#wb-nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === name));
  const box = $('#wb-view');
  if (name === 'todo') {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.scrollTop = 0;
  if (name === 'patients') return renderPatients(box);
  if (name === 'reports') return renderReports(box);
  if (name === 'board') return renderBoard(box);
  if (name === 'rules') return renderRules(box);
  if (name === 'follow') return renderFollow(box);
}

function renderPatients(box) {
  const rows = PATIENTS.map(
    (p) => `<tr>
      <td class="nm">${p[0]} <span class="dim" style="font-weight:400">${p[1]}</span></td>
      <td class="dim">${p[2]}</td>
      <td><span class="tagx ${p[3]}">${p[3] === 'red' ? '红灯' : p[3] === 'amber' ? '黄灯' : '绿'}</span></td>
      <td class="num">${p[4]}</td>
      <td class="dim num">${p[5]}</td>
      <td class="dim">${p[6]}</td>
      <td><span class="link" onclick="toast('已在今日待办中定位到 ${p[0]}')">查看</span></td>
    </tr>`
  ).join('');

  box.innerHTML = `
    <div class="v-head">
      <h3>在管患者</h3>
      <p>共 312 人 · 按最后互动时间排序</p>
      <span class="sp">导出 CSV</span>
    </div>
    <div class="vfilters">
      <button class="on">全部 312</button>
      <button>红灯 11</button>
      <button>黄灯 46</button>
      <button>绿 255</button>
      <button>7 天未打卡 38</button>
      <button>逾期随访 8</button>
      <button>未绑定家属 94</button>
    </div>
    <table class="vt">
      <thead><tr>
        <th>患者</th><th>病种</th><th>分层</th><th>30 天打卡率</th><th>最后互动</th><th>责任</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="rnote">
      这一页默认按「最后互动时间」倒序，不是按姓名。因为看不见的那个人才最需要你。
      打卡率低于 50% 的会自动进今日待办的「未打卡」分组，不用你手动筛。
    </div>`;
}

function renderReports(box) {
  const rows = REPORTS.map(
    (r) => `<tr>
      <td class="nm">${r[0]}</td>
      <td class="dim num">${r[1]}</td>
      <td class="dim">${r[2]}</td>
      <td><span class="tagx ${r[5]}">${r[3]}</span></td>
      <td class="dim">AI 草稿已生成 · 待医师确认</td>
      <td><span class="link" onclick="toast('打开 ${r[0]} 的报告：AI 草稿 + 5 条异常项，医生可改可驳')">审核</span></td>
    </tr>`
  ).join('');

  box.innerHTML = `
    <div class="v-head">
      <h3>报告审阅</h3>
      <p>AI 只出草稿，未经医师确认患者看不到</p>
      <span class="sp">待审 9 · 今日已审 14</span>
    </div>
    <div class="vfilters">
      <button class="on">全部 9</button>
      <button>红灯项 5</button>
      <button>黄灯项 2</button>
      <button>无异常 2</button>
      <button>已驳回 1</button>
      <button>超 24h 未审 2</button>
    </div>
    <table class="vt">
      <thead><tr>
        <th>患者</th><th>日期</th><th>项目</th><th>异常项</th><th>状态</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="board-row" style="margin-top:20px">
      <div class="bpanel"><h4>AI 草稿示例（朱凤兰 · 11/14 生化 + 糖化）</h4>
        <div style="font-size:12.5px;line-height:1.85;color:var(--ink-2)">
          朱阿姨，这次结果里有两项要注意。<br>
          <b>糖化血红蛋白 9.1%</b>，比三个月前的 8.2% 又高了一点 —— 这个数反映的是过去三个月的平均水平，说明这段时间血糖整体偏高。<br>
          <b>低密度脂蛋白 3.8</b>，超过你的目标值 2.6。<br>
          接下来三件事：<br>
          1. 晚饭主食减到一小碗，先减米饭，粥换成杂粮饭；<br>
          2. 每天早晚各测一次血糖，直接记在微信里，我这边能看到；<br>
          3. 联系王医生调整降糖方案 —— <b>先别自己加药</b>。<br>
          <span style="color:var(--muted)">以上由 AI 起草，王立群 医生已审核 · 11/14 11:20</span>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn-sm primary" onclick="toast('已确认 · 推送至患者微信，留痕「王立群 11/14 11:20 确认」')">确认发出</button>
          <button class="btn-sm" onclick="toast('已进入编辑 · 医生改完再发，diff 会存进审计日志')">修改后发</button>
          <button class="btn-sm" onclick="toast('已驳回 · 标记为模型需复核，进月度质检抽样')">驳回重做</button>
        </div>
      </div>
      <div class="bpanel"><h4>审核留痕（这份报告的全部动作）</h4>
        <table class="vt" style="margin-top:0">
          <tbody>
            <tr><td class="dim num">11/14 08:12</td><td>患者上传报告 3 张</td><td class="dim">朱凤兰 · 微信</td></tr>
            <tr><td class="dim num">11/14 08:12</td><td>OCR 识别 24 项，命中参考区间 19 项</td><td class="dim">系统</td></tr>
            <tr><td class="dim num">11/14 08:13</td><td>AI 生成解读草稿（未发送）</td><td class="dim">model-v3 · 2.1s</td></tr>
            <tr><td class="dim num">11/14 11:18</td><td>医生修改第 3 条：把「加药」改成「联系王医生调整方案」</td><td class="dim">王立群</td></tr>
            <tr><td class="dim num">11/14 11:20</td><td>确认发出，患者端可见</td><td class="dim">王立群</td></tr>
          </tbody>
        </table>
        <div class="rnote" style="margin-top:14px;padding:12px 14px">
          驳回三次的同病种报告会被标记为模型需要复核，进月度质检抽样。患者投诉时，这条链能证明
          「谁在什么时候改了什么」，也能证明医生确实看过 —— 这是 AI 进医疗的最小合规成本。
        </div>
      </div>
    </div>`;
}

function renderBoard(box) {
  const bars = [
    ['30 天活跃管理率', 64, 'ok'],
    ['失访率', 12, 'ok'],
    ['红灯 24h 处置率', 97, 'ok'],
    ['复诊转化率', 47, 'ok'],
    ['家属绑定率', 70, 'warn'],
    ['AI 建议采纳率', 73, 'ok'],
  ]
    .map(
      (b) => `<div class="bar">
        <span class="bl">${b[0]}</span>
        <span class="bt"><i class="${b[2] === 'ok' ? '' : 'warn'}" style="width:${b[1]}%"></i></span>
        <span class="bv">${b[1]}%</span>
      </div>`
    )
    .join('');

  const dist = [
    ['绿 · 稳定在管', 255, ''],
    ['黄 · 需关注', 46, 'warn'],
    ['红 · 需处置', 11, 'bad'],
  ]
    .map(
      (d) => `<div class="bar">
        <span class="bl">${d[0]}</span>
        <span class="bt"><i class="${d[2]}" style="width:${(d[1] / 312) * 100}%"></i></span>
        <span class="bv">${d[1]}</span>
      </div>`
    )
    .join('');

  box.innerHTML = `
    <div class="v-head">
      <h3>数据看板</h3>
      <p>近 30 天 · 城南社区卫生服务中心</p>
      <span class="sp">更新于 21:00</span>
    </div>
    <div class="board-grid">
      <div class="bcard"><div class="k">在管患者</div><div class="n">312<small>人</small></div><div class="d up">↑ 18 较上月</div></div>
      <div class="bcard"><div class="k">30 天活跃管理率</div><div class="n">64<small>%</small></div><div class="d up">↑ 7pt</div></div>
      <div class="bcard"><div class="k">失访率</div><div class="n">12<small>%</small></div><div class="d up">↓ 4pt</div></div>
      <div class="bcard"><div class="k">人均在管</div><div class="n">156<small>人</small></div><div class="d up">↑ 从 80</div></div>
    </div>
    <div class="board-row">
      <div class="bpanel"><h4>核心指标（目标线：活跃 ≥60%、失访 ≤15%）</h4>${bars}</div>
      <div class="bpanel"><h4>分层分布（312 人）</h4>${dist}
        <h4 style="margin-top:18px">本周处置时效</h4>
        <div class="bar"><span class="bl">红灯首次响应</span><span class="bt"><i class="bad" style="width:82%"></i></span><span class="bv">21 分钟</span></div>
        <div class="bar"><span class="bl">黄灯 48h 内</span><span class="bt"><i class="warn" style="width:91%"></i></span><span class="bv">91%</span></div>
        <div class="bar"><span class="bl">失访 30 天回收</span><span class="bt"><i style="width:34%"></i></span><span class="bv">34%</span></div>
      </div>
    </div>
    <div class="board-row">
      <div class="bpanel"><h4>本月流失漏斗</h4>
        <table class="vt" style="margin-top:0">
          <tbody>
            <tr><td class="dim">应随访 312 人</td><td class="num" style="text-align:right">312</td></tr>
            <tr><td class="dim">30 天内有 ≥8 天打卡</td><td class="num" style="text-align:right">200 · 64%</td></tr>
            <tr><td class="dim">医护触达并得到回应</td><td class="num" style="text-align:right">227 · 73%</td></tr>
            <tr><td class="dim">连续 14 天无任何互动</td><td class="num" style="text-align:right;color:var(--red)">37 · 12%</td></tr>
            <tr><td class="dim">已回收（重新打卡）</td><td class="num" style="text-align:right">13</td></tr>
          </tbody>
        </table>
      </div>
      <div class="bpanel"><h4>AI 使用情况（本周）</h4>
        <table class="vt" style="margin-top:0">
          <tbody>
            <tr><td class="dim">报告解读草稿</td><td class="num" style="text-align:right">63 份 · 采纳 47 · 采纳率 75%</td></tr>
            <tr><td class="dim">话术生成</td><td class="num" style="text-align:right">182 条 · 采纳 139 · 76%</td></tr>
            <tr><td class="dim">待办优先级排序</td><td class="num" style="text-align:right">排序后前 5 命中 4 · 80%</td></tr>
            <tr><td class="dim">患者提问拦截</td><td class="num" style="text-align:right">41 次 · 转人工 9 · 22%</td></tr>
            <tr><td class="dim">AI 成本（本周）</td><td class="num" style="text-align:right">¥ 118 · 人均 ¥0.38</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="rnote">
      北极星是「30 天活跃管理率」，不是血糖达标率。达标率受病情和用药影响，工具管不了；
      人还在不在管，工具管得了。活跃的定义：30 天内有 ≥8 天打卡，或被医护主动触达并回应过一次。
    </div>`;
}

function renderFollow(box) {
  const rows = [
    ['今天 09:12', '张桂芳', '电话', '已联系', '自述昨晚吃了咸菜，已提醒；答应明早复测', '李静'],
    ['今天 08:40', '朱凤兰', '企微', '未接', '发了 3 条未回，转电话失败，已排明天再打', '王芳'],
    ['今天 08:22', '刘桂英', '电话', '已转医生', '自述停药 4 天，已约王医生今天下午', '李静'],
    ['今天 08:12', '陈国强', '企微', '已联系', '发了复测指导，家属代回：今晚测完报数', '李静'],
    ['今天 07:55', '吴桂香', '企微', '已联系', '问「血糖 9.1 算高吗」，按知识库回了，患者说知道了', '王芳'],
    ['今天 07:30', '赵德海', '企微', '已联系', 'AI 自动周报已发，患者回了个「好」', 'AI'],
    ['11/13 16:40', '王秀兰', '电话', '已联系', '女儿接的，说这几天没称体重，已重新教一遍', '王芳'],
    ['11/13 15:02', '周建华', '电话', '拒访', '「我挺好的不用管」，已记录，30 天后再触达', '王芳'],
    ['11/13 11:20', '孙玉梅', '企微', '已联系', '血钾 3.3，已告知多吃香蕉菠菜，下周复查', '王芳'],
    ['11/13 10:05', '马国强', '电话', '已联系', '复诊提醒，已约 11/20 上午 9:30', '李静'],
  ]
    .map(
      (r) => `<tr>
      <td class="dim num">${r[0]}</td>
      <td class="nm">${r[1]}</td>
      <td class="dim">${r[2]}</td>
      <td><span class="tagx ${r[3] === '已联系' ? 'green' : r[3] === '拒访' ? 'red' : ''}">${r[3]}</span></td>
      <td class="dim">${r[4]}</td>
      <td class="dim">${r[5]}</td>
    </tr>`
    )
    .join('');

  box.innerHTML = `
    <div class="v-head">
      <h3>随访记录</h3>
      <p>每条都可追溯到人、渠道、时间</p>
      <span class="sp">本周 214 条</span>
    </div>
    <div class="vfilters">
      <button class="on">全部 214</button>
      <button>电话 96</button>
      <button>企微 118</button>
      <button>未接 22</button>
      <button>拒访 7</button>
      <button>AI 自动 61</button>
    </div>
    <table class="vt">
      <thead><tr><th>时间</th><th>患者</th><th>渠道</th><th>结果</th><th>一句话记录</th><th>执行人</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="board-row" style="margin-top:20px">
      <div class="bpanel"><h4>触达效果（近 30 天）</h4>
        <div class="bar"><span class="bl">企微送达率</span><span class="bt"><i style="width:94%"></i></span><span class="bv">94%</span></div>
        <div class="bar"><span class="bl">企微已读率</span><span class="bt"><i style="width:71%"></i></span><span class="bv">71%</span></div>
        <div class="bar"><span class="bl">电话接通率</span><span class="bt"><i class="warn" style="width:58%"></i></span><span class="bv">58%</span></div>
        <div class="bar"><span class="bl">触达后有动作</span><span class="bt"><i style="width:63%"></i></span><span class="bv">63%</span></div>
      </div>
      <div class="bpanel"><h4>渠道选择规则</h4>
        <div class="rrow" style="padding:8px 0"><div class="rk" style="width:104px">红灯</div><div class="rv">先电话（15 分钟内），失败转企微 + 家属</div></div>
        <div class="rrow" style="padding:8px 0"><div class="rk" style="width:104px">黄灯</div><div class="rv">先企微（模板消息），24 小时无回应转电话</div></div>
        <div class="rrow" style="padding:8px 0"><div class="rk" style="width:104px">绿灯</div><div class="rv">只在周报与复诊提醒时触达，其余不打扰</div></div>
        <div class="rrow" style="padding:8px 0;border-bottom:none"><div class="rk" style="width:104px">连续未接</div><div class="rv">3 次未接改寄短信 + 家属电话，仍无回应进失访池</div></div>
      </div>
    </div>
    <div class="rnote">
      「拒访」不是失败，是一种结果。记下来，30 天后再触达 —— 反复打只会让人拉黑你。
      这条记录同时进审计日志：谁在什么时候联系了谁、说了什么，患者投诉时能查。
    </div>`;
}

function renderRules(box) {
  const rows = [
    ['血压红灯', '收缩压 ≥ <em>175</em> 或舒张压 ≥ <em>105</em>', '修改'],
    ['血压黄灯', '收缩压 ≥ 150 或舒张压 ≥ 95', '修改'],
    ['血糖红灯（空腹）', '≥ <em>13.9</em> 或 &lt; 3.9 mmol/L', '修改'],
    ['血糖红灯（餐后）', '≥ <em>16.7</em> mmol/L', '修改'],
    ['体重（心衰）', '3 天涨 &gt; 2kg 或出现水肿', '修改'],
    ['红灯响应时限', '<em>15 分钟</em>内首次触达，24 小时内闭环', '修改'],
    ['升级链', '责任护士 → 值班医生 → 机构负责人（逐级 15 分钟未响应自动升级）', '修改'],
    ['消息频控', '同类消息 24 小时内最多 1 条；免打扰 21:30–07:00 只发红灯', '修改'],
    ['静默期', '结案后 90 天不再触达，除非患者主动发起', '修改'],
  ]
    .map(
      (r) => `<div class="rrow">
      <div class="rk">${r[0]}</div>
      <div class="rv">${r[1]}</div>
      <div class="ra"><span onclick="toast('已打开「${r[0]}」的编辑面板 · 改动会写入审计日志并通知全体医护')">${r[2]}</span></div>
    </div>`
    )
    .join('');

  box.innerHTML = `
    <div class="v-head">
      <h3>规则配置</h3>
      <p>改一次全机构生效，所以每次改动都留痕</p>
      <span class="sp">上次修改 10/28 · 王立群</span>
    </div>
    <div class="rulegrid">${rows}</div>
    <h4 style="font-size:12.5px;color:var(--muted);margin:22px 0 8px">任务模板（建档时按病种 × 分层自动生成，之后可单条改）</h4>
    <table class="vt" style="margin-top:0">
      <thead><tr><th>病种 · 分层</th><th>每日任务</th><th>每周任务</th><th>复诊周期</th><th>首条消息发给谁</th></tr></thead>
      <tbody>
        <tr><td class="nm">高血压 · 黄灯</td><td>测血压 1 次（7:00–9:00）· 服药 1 次</td><td>体重 2 次</td><td>30 天</td><td>患者本人</td></tr>
        <tr><td class="nm">高血压 · 红灯</td><td>测血压 2 次（早晚）· 服药 1 次</td><td>体重 3 次</td><td>7 天</td><td>患者 + 家属</td></tr>
        <tr><td class="nm">2 型糖尿病 · 黄灯</td><td>血糖 2 次（空腹 + 任一早餐后）· 服药 1 次</td><td>足部检查 1 次</td><td>30 天</td><td>患者本人</td></tr>
        <tr><td class="nm">2 型糖尿病 · 红灯</td><td>血糖 3 次（空腹 + 早晚餐后）· 服药 2 次</td><td>足部检查 2 次 · 体重 2 次</td><td>14 天</td><td>患者 + 家属</td></tr>
        <tr><td class="nm">心衰 · 任意</td><td>体重 1 次（晨起排空后）· 症状 1 次</td><td>—</td><td>14 天</td><td>患者 + 家属</td></tr>
      </tbody>
    </table>
    <div class="rulegrid" style="margin-top:18px;border-top:none">
      <div class="rrow"><div class="rk">升级通知文案</div><div class="rv">「{患者} {指标} {值}，超过红灯阈值，责任护士 {护士} 已收到，请在 15 分钟内首次触达。」—— 发到机构内部群，不发患者</div><div class="ra"><span onclick="toast('文案模板可改，支持变量 {患者} {指标} {值} {护士} {时限}')">修改</span></div></div>
      <div class="rrow"><div class="rk">患者端红灯文案</div><div class="rv">「已通知{护士}，{时限}内会给你回电」+ 三条处置动作。不写「你的情况很危险」，只写下一步做什么</div><div class="ra"><span onclick="toast('已打开文案编辑器 · 可 A/B 两版对比 7 天打卡率')">修改</span></div></div>
    </div>
    <div class="rnote">
      阈值不是产品拍的，是机构按自己的指南口径填的。红线数字比诊室诊断阈值低一档，因为已经在管的患者出现 175/105，
      说明方案失效了，等不到 180。<br>
      改阈值会弹二次确认，并要求填「修改理由」—— 理由进审计日志，季度复盘时用来解释为什么这个月红灯变多了。
    </div>`;
}

/* ---------------- 启动 ---------------- */
renderMetric('bp');
renderQueue();
renderDetail();
wbView('todo');
