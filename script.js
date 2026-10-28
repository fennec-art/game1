(() => {
  // ===== 설정값 =====
  const COLS = 20;           // 가로 칸 수
  const ROWS = 20;           // 세로 칸 수
  const CELL = 20;           // 기준 셀 크기(px)
  const BASE_SPEED = 130;    // 시작 이동 간격(ms)
  const MIN_SPEED = 65;      // 최대 속도(이동 간격 하한)
  const SPEED_STEP = 4;      // 먹이 하나당 빨라지는 정도(ms)
  const STORAGE_KEY = 'snake-best';

  const BOOST_DURATION = 5000;   // 부스트 지속 시간(ms)
  const BOOST_FACTOR = 2;        // 부스트 중 속도 배율
  const BONUS_DELAY_MIN = 4000;  // 특수 아이템 재등장 최소 대기(ms)
  const BONUS_DELAY_MAX = 9000;  // 특수 아이템 재등장 최대 대기(ms)

  // ===== DOM =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const startBtn = document.getElementById('startBtn');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const bgm = document.getElementById('bgm');
  bgm.volume = 0.4;

  // ===== 상태 =====
  const DIRS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  let snake;      // 뱀 몸통 좌표 배열 (0번이 머리)
  let dir;        // 현재 진행 방향
  let nextDir;    // 다음 틱에 적용할 방향 (입력 버퍼)
  let food;       // 먹이 좌표
  let bonus;      // 부스트 아이템 좌표 (없으면 null)
  let score;
  let best;
  let timer;
  let state;      // idle | playing | paused | over
  let speed;
  let cell = CELL;

  let bonusTimer;      // 부스트 아이템 재등장 타이머
  let boostTimer;      // 부스트 종료 타이머
  let boostRemain = 0; // 남은 부스트 시간(ms). 0이면 부스트 아님
  let boostEnd = 0;    // 부스트 종료 시각(ms)

  best = Number(localStorage.getItem(STORAGE_KEY) || 0);
  bestEl.textContent = best;

  // ===== 캔버스 크기 조정 (고해상도 대응) =====
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(400, window.innerWidth - 40, window.innerHeight - 260);
    const px = Math.max(240, Math.floor(size / CELL) * CELL);

    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    canvas.width = px * dpr;
    canvas.height = px * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = px / COLS;

    if (state === 'idle') draw();
  }

  // ===== 초기화 =====
  function reset() {
    stopBoost();
    clearTimeout(bonusTimer);
    bonusTimer = null;

    snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir = DIRS.right;
    nextDir = DIRS.right;
    score = 0;
    speed = BASE_SPEED;
    scoreEl.textContent = '0';

    food = null;
    bonus = null;
    placeFood();
    placeBonus();

    state = 'idle';
    draw();
  }

  // 뱀/제외 대상이 차지하지 않은 칸 중 하나를 무작위로 반환
  function randomEmptyCell(...exclude) {
    const blocked = exclude.filter(Boolean);
    const cells = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (snake.some(s => s.x === x && s.y === y)) continue;
        if (blocked.some(e => e.x === x && e.y === y)) continue;
        cells.push({ x, y });
      }
    }
    return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
  }

  function placeFood() {
    food = randomEmptyCell(bonus);
  }

  function placeBonus() {
    bonus = randomEmptyCell(food);
  }

  // 부스트 아이템을 일정 시간 뒤에 다시 등장시킴
  function scheduleBonus() {
    clearTimeout(bonusTimer);
    const delay = BONUS_DELAY_MIN + Math.random() * (BONUS_DELAY_MAX - BONUS_DELAY_MIN);
    bonusTimer = setTimeout(() => {
      bonusTimer = null;
      placeBonus();
      draw();
    }, delay);
  }

  // ===== 배경음악 =====
  // 브라우저 자동재생 정책상 사용자 조작(시작 버튼/키 입력) 이후에만 재생된다
  function playBgm() {
    bgm.play().catch(() => {});
  }

  function pauseBgm() {
    bgm.pause();
  }

  function start() {
    reset();
    state = 'playing';
    hideOverlay();
    playBgm();
    restartTimer();
  }

  // ===== 타이머 =====
  // 부스트 중이면 이동 간격을 절반으로 줄여 2배 빠르게 만든다
  function currentInterval() {
    return isBoosting() ? Math.max(30, speed / BOOST_FACTOR) : speed;
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(tick, currentInterval());
  }

  // ===== 부스트 =====
  function isBoosting() {
    return boostRemain > 0;
  }

  function activateBoost() {
    bonus = null;
    boostRemain = BOOST_DURATION;
    runBoostTimer();
    restartTimer();
  }

  function runBoostTimer() {
    clearTimeout(boostTimer);
    boostEnd = Date.now() + boostRemain;
    boostTimer = setTimeout(endBoost, boostRemain);
  }

  function endBoost() {
    boostTimer = null;
    boostRemain = 0;
    boostEnd = 0;
    restartTimer();
    scheduleBonus();
    draw();
  }

  // 일시정지: 남은 부스트 시간을 저장하고 종료 타이머를 멈춤
  function pauseBoost() {
    if (!boostTimer) return;
    clearTimeout(boostTimer);
    boostTimer = null;
    boostRemain = Math.max(0, boostEnd - Date.now());
  }

  // 완전 해제 (재시작 / 게임 오버)
  function stopBoost() {
    clearTimeout(boostTimer);
    boostTimer = null;
    boostRemain = 0;
    boostEnd = 0;
  }

  // ===== 게임 루프 =====
  function tick() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // 벽 충돌
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) return gameOver();

    // 자기 몸 충돌 (꼬리는 이번 틱에 빠져나가므로 제외)
    if (snake.slice(0, -1).some(s => s.x === head.x && s.y === head.y)) return gameOver();

    snake.unshift(head);

    if (bonus && head.x === bonus.x && head.y === bonus.y) {
      activateBoost();          // 부스트 아이템: 5초간 2배속
    }

    if (head.x === food.x && head.y === food.y) {
      // 먹이 획득: 점수 증가, 속도 상승, 꼬리 유지
      score += 10;
      scoreEl.textContent = score;
      speed = Math.max(MIN_SPEED, speed - SPEED_STEP);
      restartTimer();
      placeFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function gameOver() {
    clearInterval(timer);
    clearTimeout(bonusTimer);
    bonusTimer = null;
    stopBoost();
    pauseBgm();
    state = 'over';

    if (score > best) {
      best = score;
      localStorage.setItem(STORAGE_KEY, best);
      bestEl.textContent = best;
    }

    showOverlay('게임 오버', `점수 <b>${score}</b> · 최고 <b>${best}</b>`, '다시 하기');
    draw();
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      clearInterval(timer);
      pauseBoost();
      pauseBgm();
      showOverlay('일시정지', 'Space 를 누르면 계속합니다', '계속');
    } else if (state === 'paused') {
      state = 'playing';
      hideOverlay();
      if (isBoosting()) runBoostTimer();
      playBgm();
      restartTimer();
    }
  }

  // ===== 렌더링 =====
  function draw() {
    const w = COLS * cell;
    const h = ROWS * cell;
    ctx.clearRect(0, 0, w, h);

    drawGrid(w, h);
    drawFood();
    drawBonus();
    if (!snake) return;
    drawSnake();

    // 눈: 진행 방향 앞쪽에 좌우 대칭으로 배치
    if (snake[0]) {
      const head = snake[0];
      const cx = head.x * cell + cell / 2;
      const cy = head.y * cell + cell / 2;
      const fwd = cell * 0.16;        // 앞쪽 오프셋
      const side = cell * 0.19;       // 좌우 오프셋
      const px = -dir.y, py = dir.x;  // 진행 방향의 수직 벡터
      ctx.fillStyle = '#0d1219';
      [1, -1].forEach(s => {
        ctx.beginPath();
        ctx.arc(cx + dir.x * fwd + px * side * s, cy + dir.y * fwd + py * side * s, cell * 0.085, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function drawGrid(w, h) {
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;

    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell + .5, 0);
      ctx.lineTo(i * cell + .5, h);
      ctx.stroke();
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * cell + .5);
      ctx.lineTo(w, j * cell + .5);
      ctx.stroke();
    }
  }

  function drawFood() {
    if (!food) return;
    const cx = food.x * cell + cell / 2;
    const cy = food.y * cell + cell / 2;

    ctx.fillStyle = '#f85149';
    ctx.shadowColor = '#f85149';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 부스트 아이템: 금색 다이아몬드
  function drawBonus() {
    if (!bonus) return;
    const cx = bonus.x * cell + cell / 2;
    const cy = bonus.y * cell + cell / 2;
    const r = cell * 0.34;

    ctx.fillStyle = '#f2cc60';
    ctx.shadowColor = '#f2cc60';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#fff8dc';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSnake() {
    const boosting = isBoosting();
    const headColor = boosting ? '#ffe08a' : '#8ef0a0';   // 부스트 중엔 금색
    const bodyRgb = boosting ? '242,204,96' : '46,160,67';

    snake.forEach((s, i) => {
      const t = i / Math.max(1, snake.length - 1);          // 머리에 가까울수록 0
      const pad = i === 0 ? cell * 0.04 : cell * 0.1;
      ctx.fillStyle = i === 0 ? headColor : `rgba(${bodyRgb},${1 - t * 0.55})`;  // 꼬리로 갈수록 흐리게
      roundRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.28);
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // ===== 오버레이 =====
  function showOverlay(title, text, btn) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = text;
    startBtn.textContent = btn;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // ===== 입력 =====
  function input(name) {
    const d = DIRS[name];
    if (!d || state === 'idle' || state === 'over') return;
    if (d.x === -dir.x && d.y === -dir.y) return;   // 반대 방향 전환 금지
    nextDir = d;
  }

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();

    if (k === 'arrowup' || k === 'w') input('up');
    else if (k === 'arrowdown' || k === 's') input('down');
    else if (k === 'arrowleft' || k === 'a') input('left');
    else if (k === 'arrowright' || k === 'd') input('right');
    else if (k === ' ') {
      if (state === 'playing' || state === 'paused') togglePause();
    } else if (k === 'r') {
      start();
    } else if (k === 'enter' && (state === 'idle' || state === 'over')) {
      start();
    }
  });

  // 모바일 방향 패드
  document.querySelectorAll('.pad button').forEach(b => {
    b.addEventListener('click', () => input(b.dataset.dir));
  });

  startBtn.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else start();
  });

  window.addEventListener('resize', resize);

  // ===== 시작 =====
  reset();
  resize();
})();
