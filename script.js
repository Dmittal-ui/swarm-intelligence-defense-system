/**
 * ============================================================
 * SWARM DEFENSE — script.js
 * Autonomous Drone Swarm Defense Simulator
 * Decentralized, no central controller.
 * ============================================================
 */

// ─── Canvas Setup ───────────────────────────────────────────
const canvas  = document.getElementById('simCanvas');
const ctx     = canvas.getContext('2d');

// Resize canvas to match its CSS size
function resizeCanvas() {
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Simulation State ────────────────────────────────────────
const state = {
  running:       false,
  paused:        false,
  destroyed:     0,
  baseDamage:    0,
  waves:         0,
  spawnTimer:    0,
  animFrame:     null,
  lastTime:      0,
  friendlyDrones:[],
  enemyDrones:   [],
  nextId:        0,
  totalSpawned:  0,
};

// ─── Parameters (from UI sliders) ───────────────────────────
const params = {
  numFriendly: 6,
  numEnemy:    8,
  enemySpeed:  1.2,
  spawnRate:   4,          // seconds between wave spawns
};

// ─── Constants ──────────────────────────────────────────────
const FRIENDLY_SPEED    = 2.6;  // px/frame at 60fps
const FRIENDLY_RADIUS   = 7;
const ENEMY_RADIUS      = 6;
const BASE_RADIUS       = 22;
const INTERCEPT_DIST    = 10;   // collision threshold
const SEPARATION_DIST   = 24;   // min distance between friendly drones
const SEPARATION_FORCE  = 0.45;
const BASE_MAX_HP       = 100;
const DAMAGE_PER_HIT    = 10;

// ─── Drone Classes ───────────────────────────────────────────

/**
 * Friendly Drone:
 * Operates autonomously — no central controller.
 * Each instance independently selects its target
 * based on the threat model: threat = 1 / dist_to_base
 */
class FriendlyDrone {
  constructor(id, x, y) {
    this.id       = id;
    this.x        = x;
    this.y        = y;
    this.vx       = 0;
    this.vy       = 0;
    this.target   = null;   // Reference to targeted EnemyDrone
    this.state    = 'idle'; // 'idle' | 'chasing'
    this.pulseT   = Math.random() * Math.PI * 2; // visual pulse offset
    this.trail    = [];     // last N positions for motion trail
  }

  /**
   * selectTarget — DECENTRALIZED TARGET SELECTION
   * No central assignment. Each drone computes threat
   * independently and picks the highest-threat enemy.
   * Threat = 1 / distance_to_base (closer = more dangerous)
   */
  selectTarget(enemies) {
    if (enemies.length === 0) {
      this.target = null;
      this.state  = 'idle';
      return;
    }

    let bestEnemy = null;
    let bestScore = -Infinity;
    const base    = getBasePos();

    for (const enemy of enemies) {
      const dBase  = dist(enemy.x, enemy.y, base.x, base.y);
      const threat = 1 / Math.max(dBase, 1);          // threat model
      const dSelf  = dist(this.x, this.y, enemy.x, enemy.y);
      // Combined score: high threat + proximity to THIS drone
      const score  = threat * 1.5 - dSelf * 0.002;
      if (score > bestScore) {
        bestScore = score;
        bestEnemy = enemy;
      }
    }

    this.target = bestEnemy;
    this.state  = bestEnemy ? 'chasing' : 'idle';
  }

  /**
   * move — compute velocity toward target
   * + separation from other friendly drones (swarm behavior)
   */
  move(friendlies) {
    // Save trail point every 3rd call (throttled)
    if (Math.random() < 0.3) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 8) this.trail.shift();
    }

    if (!this.target) {
      // No target: gentle drift toward base center
      const base = getBasePos();
      const dx   = base.x - this.x;
      const dy   = base.y - this.y;
      const d    = Math.sqrt(dx*dx + dy*dy);
      if (d > 60) {
        this.vx = (dx / d) * 0.5;
        this.vy = (dy / d) * 0.5;
      } else {
        this.vx *= 0.9;
        this.vy *= 0.9;
      }
    } else {
      // Move toward target
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d > 0) {
        this.vx = (dx / d) * FRIENDLY_SPEED;
        this.vy = (dy / d) * FRIENDLY_SPEED;
      }
    }

    // Separation: push away from nearby friendly drones
    let sx = 0, sy = 0;
    for (const other of friendlies) {
      if (other.id === this.id) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d < SEPARATION_DIST && d > 0) {
        sx += (dx / d) * (SEPARATION_DIST - d);
        sy += (dy / d) * (SEPARATION_DIST - d);
      }
    }
    this.vx += sx * SEPARATION_FORCE * 0.1;
    this.vy += sy * SEPARATION_FORCE * 0.1;

    // Clamp speed
    const spd = Math.sqrt(this.vx*this.vx + this.vy*this.vy);
    if (spd > FRIENDLY_SPEED) {
      this.vx = (this.vx / spd) * FRIENDLY_SPEED;
      this.vy = (this.vy / spd) * FRIENDLY_SPEED;
    }

    this.x += this.vx;
    this.y += this.vy;

    // Keep within canvas bounds
    this.x = clamp(this.x, FRIENDLY_RADIUS, canvas.width  - FRIENDLY_RADIUS);
    this.y = clamp(this.y, FRIENDLY_RADIUS, canvas.height - FRIENDLY_RADIUS);

    this.pulseT += 0.05;
  }

  draw() {
    // Motion trail
    for (let i = 0; i < this.trail.length; i++) {
      const alpha = (i / this.trail.length) * 0.25;
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, FRIENDLY_RADIUS * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(59,158,255,${alpha})`;
      ctx.fill();
    }

    // Outer glow ring (pulses)
    const glowR = FRIENDLY_RADIUS + 4 + Math.sin(this.pulseT) * 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(59,158,255,0.25)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Main body
    ctx.beginPath();
    ctx.arc(this.x, this.y, FRIENDLY_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle   = '#3b9eff';
    ctx.shadowColor = '#3b9eff';
    ctx.shadowBlur  = 12;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Inner highlight
    ctx.beginPath();
    ctx.arc(this.x - 2, this.y - 2, FRIENDLY_RADIUS * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();

    // Target lock line
    if (this.target) {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.target.x, this.target.y);
      ctx.strokeStyle = 'rgba(0,212,255,0.35)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/**
 * Enemy Drone:
 * Autonomously moves toward the base.
 * Speed scales with params.enemySpeed.
 */
class EnemyDrone {
  constructor(id, x, y) {
    this.id     = id;
    this.x      = x;
    this.y      = y;
    this.vx     = 0;
    this.vy     = 0;
    this.pulseT = Math.random() * Math.PI * 2;
    this.trail  = [];
  }

  /** Move straight toward base */
  move() {
    if (Math.random() < 0.3) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 6) this.trail.shift();
    }

    const base = getBasePos();
    const dx   = base.x - this.x;
    const dy   = base.y - this.y;
    const d    = Math.sqrt(dx*dx + dy*dy);
    if (d > 0) {
      this.vx = (dx / d) * params.enemySpeed;
      this.vy = (dy / d) * params.enemySpeed;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.pulseT += 0.06;
  }

  draw() {
    // Motion trail (red)
    for (let i = 0; i < this.trail.length; i++) {
      const alpha = (i / this.trail.length) * 0.2;
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, ENEMY_RADIUS * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,60,78,${alpha})`;
      ctx.fill();
    }

    // Threat ring
    const glowR = ENEMY_RADIUS + 3 + Math.sin(this.pulseT) * 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, glowR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,60,78,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Main body
    ctx.beginPath();
    ctx.arc(this.x, this.y, ENEMY_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle   = '#ff3c4e';
    ctx.shadowColor = '#ff3c4e';
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Inner cross (enemy marker)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.x - 3, this.y); ctx.lineTo(this.x + 3, this.y);
    ctx.moveTo(this.x, this.y - 3); ctx.lineTo(this.x, this.y + 3);
    ctx.stroke();
  }
}

// ─── Helpers ────────────────────────────────────────────────
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx*dx + dy*dy);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function getBasePos() {
  return { x: canvas.width / 2, y: canvas.height / 2 };
}

/**
 * spawnFriendly — place friendly drones in a ring around base
 */
function spawnFriendly(count) {
  const base = getBasePos();
  const ring  = BASE_RADIUS + 50;
  const drones = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    drones.push(new FriendlyDrone(
      state.nextId++,
      base.x + Math.cos(angle) * ring,
      base.y + Math.sin(angle) * ring
    ));
  }
  return drones;
}

/**
 * spawnEnemyWave — spawn enemies from random edges
 */
function spawnEnemyWave(count) {
  const drones = [];
  for (let i = 0; i < count; i++) {
    const edge  = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 20;
    if (edge === 0) { x = Math.random() * canvas.width;  y = margin; }
    else if (edge === 1) { x = canvas.width  - margin;   y = Math.random() * canvas.height; }
    else if (edge === 2) { x = Math.random() * canvas.width;  y = canvas.height - margin; }
    else                 { x = margin; y = Math.random() * canvas.height; }

    drones.push(new EnemyDrone(state.nextId++, x, y));
  }
  state.waves++;
  state.totalSpawned += count;
  return drones;
}

// ─── Explosion Particles ─────────────────────────────────────
const particles = [];

function createExplosion(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x, y,
      vx:   Math.cos(angle) * speed,
      vy:   Math.sin(angle) * speed,
      life: 1,
      decay: 0.04 + Math.random() * 0.04,
      r:    2 + Math.random() * 3,
      color,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color.replace('1)', `${p.life})`);
    ctx.fill();
  }
}

// ─── Draw Base ───────────────────────────────────────────────
let basePulseT = 0;

function drawBase() {
  const { x, y } = getBasePos();
  basePulseT += 0.02;

  const hpFraction = 1 - state.baseDamage / BASE_MAX_HP;
  const baseColor  = hpFraction > 0.5 ? '#00ff9d' :
                     hpFraction > 0.25 ? '#ffb700' : '#ff3c4e';

  // Radar sweep
  const sweepAngle = (Date.now() / 2000) % (Math.PI * 2);
  const sweepR     = BASE_RADIUS + 80 + Math.sin(basePulseT) * 10;
  const grad = ctx.createConicalGradient
    ? null  // Not widely supported; skip
    : null;

  // Concentric rings
  for (let r = BASE_RADIUS + 40; r <= BASE_RADIUS + 80; r += 20) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,255,157,0.07)`;
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  // Radar sweep line
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sweepAngle);
  const sweepGrad = ctx.createLinearGradient(0, 0, BASE_RADIUS + 70, 0);
  sweepGrad.addColorStop(0,   'rgba(0,255,157,0.5)');
  sweepGrad.addColorStop(0.7, 'rgba(0,255,157,0.1)');
  sweepGrad.addColorStop(1,   'rgba(0,255,157,0)');
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, BASE_RADIUS + 70, -0.05, 0.3);
  ctx.fillStyle = sweepGrad;
  ctx.fill();
  ctx.restore();

  // Outer glow ring
  ctx.beginPath();
  ctx.arc(x, y, BASE_RADIUS + 6 + Math.sin(basePulseT) * 4, 0, Math.PI * 2);
  ctx.strokeStyle = `${baseColor}55`;
  ctx.lineWidth   = 3;
  ctx.stroke();

  // Main base circle
  ctx.beginPath();
  ctx.arc(x, y, BASE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle   = baseColor;
  ctx.shadowColor = baseColor;
  ctx.shadowBlur  = 20;
  ctx.fill();
  ctx.shadowBlur  = 0;

  // Inner base detail
  ctx.beginPath();
  ctx.arc(x, y, BASE_RADIUS * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, BASE_RADIUS * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = baseColor;
  ctx.fill();

  // HP arc
  const hpAngle = hpFraction * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(x, y, BASE_RADIUS + 14, -Math.PI / 2, -Math.PI / 2 + hpAngle);
  ctx.strokeStyle = baseColor;
  ctx.lineWidth   = 3;
  ctx.stroke();
}

// ─── Draw Grid / Background ──────────────────────────────────
function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Dark background fill
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle vignette
  const vgGrad = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, canvas.width*0.2,
    canvas.width/2, canvas.height/2, canvas.width*0.75
  );
  vgGrad.addColorStop(0, 'rgba(0,0,0,0)');
  vgGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vgGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ─── UI Update ───────────────────────────────────────────────
const elDestroyed  = document.getElementById('statDestroyed');
const elActive     = document.getElementById('statActive');
const elFriendly   = document.getElementById('statFriendly');
const elWaves      = document.getElementById('statWaves');
const elEfficiency = document.getElementById('statEfficiency');
const elBaseHp     = document.getElementById('statBaseHp');
const elLog        = document.getElementById('eventLog');
const elStatus     = document.getElementById('statusBadge');
const elOverlay    = document.getElementById('canvasOverlay');

function updateUI() {
  elDestroyed.textContent = state.destroyed;
  elActive.textContent    = state.enemyDrones.length;
  elFriendly.textContent  = state.friendlyDrones.length;
  elWaves.textContent     = state.waves;

  const eff = state.totalSpawned > 0
    ? Math.round((state.destroyed / state.totalSpawned) * 100)
    : '--';
  elEfficiency.textContent = eff === '--' ? '--' : `${eff}%`;

  const hp = Math.max(0, BASE_MAX_HP - state.baseDamage);
  elBaseHp.textContent     = `${hp}%`;

  if (hp <= 0) {
    gameOver();
  }
}

function logEvent(msg, type = 'log-system') {
  const entry       = document.createElement('div');
  entry.className   = `log-entry ${type}`;
  const now         = new Date();
  const ts          = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
  entry.textContent = `[${ts}] ${msg}`;
  elLog.appendChild(entry);
  elLog.scrollTop   = elLog.scrollHeight;
  // Keep log from growing too large
  while (elLog.children.length > 80) {
    elLog.removeChild(elLog.firstChild);
  }
}

function setStatus(label, cls) {
  elStatus.textContent = `● ${label}`;
  elStatus.className   = `status-badge ${cls}`;
}

// ─── Core Simulation Loop ─────────────────────────────────────
function tick(timestamp) {
  if (!state.running || state.paused) return;

  const dt = timestamp - state.lastTime;
  state.lastTime = timestamp;

  // ── Enemy Spawn Timer ──
  state.spawnTimer += dt / 1000;
  if (state.spawnTimer >= params.spawnRate) {
    state.spawnTimer = 0;
    const newEnemies = spawnEnemyWave(params.numEnemy);
    state.enemyDrones.push(...newEnemies);
    logEvent(`Wave ${state.waves} spawned — ${params.numEnemy} enemy drones incoming`, 'log-wave');
  }

  // ── Each friendly drone: select target, then move ──
  for (const fd of state.friendlyDrones) {
    fd.selectTarget(state.enemyDrones);
    fd.move(state.friendlyDrones);
  }

  // ── Each enemy drone: move toward base ──
  const base      = getBasePos();
  const toRemove  = new Set();

  for (const ed of state.enemyDrones) {
    ed.move();

    // Check if enemy reached base
    if (dist(ed.x, ed.y, base.x, base.y) <= BASE_RADIUS + ENEMY_RADIUS) {
      toRemove.add(ed.id);
      state.baseDamage += DAMAGE_PER_HIT;
      createExplosion(ed.x, ed.y, 'rgba(255,60,78,1)');
      logEvent(`⚠ Base hit! Integrity at ${BASE_MAX_HP - state.baseDamage}%`, 'log-breach');
    }
  }

  // ── Interception checks ──
  for (const fd of state.friendlyDrones) {
    if (!fd.target) continue;
    if (toRemove.has(fd.target.id)) { fd.target = null; continue; }

    const d = dist(fd.x, fd.y, fd.target.x, fd.target.y);
    if (d <= INTERCEPT_DIST) {
      // Intercept!
      createExplosion(fd.target.x, fd.target.y, 'rgba(0,255,157,1)');
      logEvent(`✓ Drone #${fd.target.id} neutralized`, 'log-intercept');
      toRemove.add(fd.target.id);
      state.destroyed++;
      fd.target = null;
    }
  }

  // ── Remove destroyed enemies ──
  state.enemyDrones = state.enemyDrones.filter(e => !toRemove.has(e.id));

  // ── Update particles ──
  updateParticles();

  // ── Render ──
  drawBackground();
  drawBase();

  for (const fd of state.friendlyDrones) fd.draw();
  for (const ed of state.enemyDrones)   ed.draw();

  drawParticles();

  // ── HUD: active drone count ──
  drawHUD();

  // ── Update stats panel ──
  updateUI();

  state.animFrame = requestAnimationFrame(tick);
}

// ─── HUD Overlay on Canvas ───────────────────────────────────
function drawHUD() {
  ctx.save();
  ctx.font        = '11px "Share Tech Mono", monospace';
  ctx.fillStyle   = 'rgba(0,212,255,0.5)';
  ctx.textAlign   = 'left';
  ctx.fillText(`FRIENDLY: ${state.friendlyDrones.length}`, 12, 20);
  ctx.fillText(`ENEMIES: ${state.enemyDrones.length}`,     12, 36);
  ctx.fillText(`DESTROYED: ${state.destroyed}`,            12, 52);
  ctx.restore();
}

// ─── Game Over ───────────────────────────────────────────────
function gameOver() {
  state.running = false;
  setStatus('BASE DESTROYED', 'paused');
  logEvent('⚡ MISSION FAILED — Base integrity at 0%', 'log-breach');
  elOverlay.classList.remove('hidden');
  document.querySelector('.overlay-text').textContent   = 'BASE DESTROYED';
  document.querySelector('.overlay-sub').textContent    = `Score: ${state.destroyed} enemies neutralized`;
  document.querySelector('.overlay-icon').textContent   = '⚠';
  document.getElementById('btnStart').disabled  = false;
  document.getElementById('btnPause').disabled  = true;
}

// ─── Controls ────────────────────────────────────────────────
function startSim() {
  if (state.running && !state.paused) return;

  if (!state.running) {
    // Fresh start
    resetSim(false);
    state.friendlyDrones = spawnFriendly(params.numFriendly);
    state.enemyDrones    = spawnEnemyWave(params.numEnemy);
    logEvent(`Simulation started — ${params.numFriendly} friendly, ${params.numEnemy} initial enemies`, 'log-wave');
  }

  state.running = true;
  state.paused  = false;
  state.lastTime = performance.now();

  elOverlay.classList.add('hidden');
  setStatus('RUNNING', 'running');

  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnPause').disabled = false;

  state.animFrame = requestAnimationFrame(tick);
}

function pauseSim() {
  if (!state.running) return;

  if (state.paused) {
    // Resume
    state.paused   = false;
    state.lastTime = performance.now();
    setStatus('RUNNING', 'running');
    document.getElementById('btnPause').textContent = '⏸ PAUSE';
    document.getElementById('btnStart').disabled    = true;
    state.animFrame = requestAnimationFrame(tick);
    logEvent('Simulation resumed', 'log-system');
  } else {
    // Pause
    state.paused = true;
    cancelAnimationFrame(state.animFrame);
    setStatus('PAUSED', 'paused');
    document.getElementById('btnPause').textContent = '▶ RESUME';
    document.getElementById('btnStart').disabled    = false;
    logEvent('Simulation paused', 'log-system');
  }
}

function resetSim(showOverlay = true) {
  cancelAnimationFrame(state.animFrame);
  state.running         = false;
  state.paused          = false;
  state.destroyed       = 0;
  state.baseDamage      = 0;
  state.waves           = 0;
  state.spawnTimer      = 0;
  state.friendlyDrones  = [];
  state.enemyDrones     = [];
  state.nextId          = 0;
  state.totalSpawned    = 0;
  particles.length      = 0;

  setStatus('STANDBY', '');
  document.getElementById('btnStart').disabled     = false;
  document.getElementById('btnPause').disabled     = true;
  document.getElementById('btnPause').textContent  = '⏸ PAUSE';
  document.querySelector('.overlay-text').textContent = 'SYSTEM READY';
  document.querySelector('.overlay-sub').textContent  = 'Configure parameters and press START';
  document.querySelector('.overlay-icon').textContent = '⬡';

  if (showOverlay) {
    elOverlay.classList.remove('hidden');
    drawBackground();
    drawBase();
  }

  updateUI();
  logEvent('System reset. Ready for new mission.', 'log-system');
}

// ─── Slider Bindings ─────────────────────────────────────────
function bindSlider(id, valId, paramKey, isFloat = false) {
  const slider = document.getElementById(id);
  const valEl  = document.getElementById(valId);
  slider.addEventListener('input', () => {
    const v = isFloat ? parseFloat(slider.value) : parseInt(slider.value);
    params[paramKey] = v;
    valEl.textContent = isFloat ? v.toFixed(1) : v;
  });
}

bindSlider('sliderFriendly', 'valFriendly', 'numFriendly');
bindSlider('sliderEnemy',    'valEnemy',    'numEnemy');
bindSlider('sliderSpeed',    'valSpeed',    'enemySpeed', true);
bindSlider('sliderSpawn',    'valSpawn',    'spawnRate');

document.getElementById('btnStart').addEventListener('click', startSim);
document.getElementById('btnPause').addEventListener('click', pauseSim);
document.getElementById('btnReset').addEventListener('click', () => resetSim(true));

// ─── Init ─────────────────────────────────────────────────────
resetSim(true);