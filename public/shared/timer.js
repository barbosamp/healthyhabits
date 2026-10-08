/*
 * Lógica pura do cronômetro, compartilhada entre servidor (Node), TV e celular.
 * Nada aqui depende de relógio global: tudo recebe `now` (ms) como parâmetro,
 * o que deixa o cálculo determinístico e fácil de testar.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BJJTimer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODES = ['rounds', 'match', 'countdown', 'stopwatch'];

  // Limites (em segundos) aceitos para cada configuração.
  var LIMITS = {
    rounds: {
      work: [5, 3600],
      rest: [0, 1800],
      rounds: [1, 99],
      prep: [0, 60]
    },
    match: { duration: [30, 3600] },
    countdown: { duration: [5, 7200] }
  };

  var DEFAULT_SETTINGS = {
    rounds: { work: 300, rest: 60, rounds: 5, prep: 10 },
    match: { duration: 300 },
    countdown: { duration: 60 }
  };

  /** Tempo decorrido (ms) do relógio no instante `now`. */
  function elapsedOf(clock, now) {
    var e = clock.accumulated + (clock.running ? now - clock.startedAt : 0);
    return e > 0 ? e : 0;
  }

  /**
   * Linha do tempo do modo atual: lista de segmentos {phase, duration(ms), round}.
   * O cronômetro livre (stopwatch) não tem segmentos.
   */
  function segmentsOf(state) {
    var s = state.settings;
    var segs = [];
    if (state.mode === 'rounds') {
      var r = s.rounds;
      if (r.prep > 0) segs.push({ phase: 'prep', duration: r.prep * 1000, round: 1 });
      for (var i = 1; i <= r.rounds; i++) {
        segs.push({ phase: 'work', duration: r.work * 1000, round: i });
        if (i < r.rounds && r.rest > 0) segs.push({ phase: 'rest', duration: r.rest * 1000, round: i + 1 });
      }
    } else if (state.mode === 'match') {
      segs.push({ phase: 'fight', duration: s.match.duration * 1000, round: 1 });
    } else if (state.mode === 'countdown') {
      segs.push({ phase: 'work', duration: s.countdown.duration * 1000, round: 1 });
    }
    // Calcula o início de cada segmento na linha do tempo.
    var t = 0;
    for (var j = 0; j < segs.length; j++) {
      segs[j].start = t;
      segs[j].index = j;
      t += segs[j].duration;
    }
    return segs;
  }

  function totalOf(segs) {
    if (!segs.length) return 0;
    var last = segs[segs.length - 1];
    return last.start + last.duration;
  }

  /**
   * Visão do cronômetro no instante `now`.
   * status: idle | running | paused | done
   * phase:  prep | work | rest | fight | done | stopwatch
   */
  function computeView(state, now) {
    var clock = state.clock;
    var elapsed = elapsedOf(clock, now);
    var started = clock.running || elapsed > 0;

    if (state.mode === 'stopwatch') {
      return {
        mode: state.mode,
        status: clock.running ? 'running' : started ? 'paused' : 'idle',
        phase: 'stopwatch',
        elapsedMs: elapsed,
        displayMs: elapsed,
        remainingMs: 0,
        segmentIndex: 0,
        segmentDurationMs: 0,
        round: 0,
        totalRounds: 0,
        progress: 0,
        next: null
      };
    }

    var segs = segmentsOf(state);
    var total = totalOf(segs);
    var totalRounds = state.mode === 'rounds' ? state.settings.rounds.rounds : 1;

    if (elapsed >= total) {
      var last = segs[segs.length - 1];
      return {
        mode: state.mode,
        status: 'done',
        phase: 'done',
        elapsedMs: total,
        displayMs: 0,
        remainingMs: 0,
        segmentIndex: segs.length,
        segmentDurationMs: last.duration,
        round: totalRounds,
        totalRounds: totalRounds,
        progress: 1,
        next: null
      };
    }

    var seg = segs[0];
    for (var i = 0; i < segs.length; i++) {
      if (elapsed < segs[i].start + segs[i].duration) { seg = segs[i]; break; }
    }

    // Parado no zero: mostra o primeiro round "de verdade" (sem a preparação).
    if (!started && seg.phase === 'prep' && segs.length > 1) {
      var first = segs[1];
      return {
        mode: state.mode,
        status: 'idle',
        phase: first.phase,
        elapsedMs: 0,
        displayMs: first.duration,
        remainingMs: first.duration,
        segmentIndex: 0,
        segmentDurationMs: first.duration,
        round: first.round,
        totalRounds: totalRounds,
        progress: 0,
        next: null
      };
    }

    var remaining = seg.start + seg.duration - elapsed;
    var nextSeg = segs[seg.index + 1] || null;
    return {
      mode: state.mode,
      status: clock.running ? 'running' : started ? 'paused' : 'idle',
      phase: seg.phase,
      elapsedMs: elapsed,
      displayMs: remaining,
      remainingMs: remaining,
      segmentIndex: seg.index,
      segmentDurationMs: seg.duration,
      round: seg.round,
      totalRounds: totalRounds,
      progress: (seg.duration - remaining) / seg.duration,
      next: nextSeg ? { phase: nextSeg.phase, durationMs: nextSeg.duration, round: nextSeg.round } : null
    };
  }

  /** Formata ms como M:SS (ou H:MM:SS). Contagens regressivas arredondam para cima. */
  function formatMs(ms, roundUp) {
    var totalSec = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    if (totalSec < 0) totalSec = 0;
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var sec = totalSec % 60;
    var ss = sec < 10 ? '0' + sec : '' + sec;
    if (h > 0) return h + ':' + (m < 10 ? '0' + m : m) + ':' + ss;
    return m + ':' + ss;
  }

  /** Texto do relógio para uma visão (o cronômetro livre conta para cima e arredonda para baixo). */
  function formatView(view) {
    if (view.phase === 'stopwatch') return formatMs(view.displayMs, false);
    return formatMs(view.displayMs, true);
  }

  var PHASE_LABELS = {
    prep: 'PREPARAR',
    work: 'TREINO',
    rest: 'DESCANSO',
    fight: 'LUTA',
    done: 'FIM',
    stopwatch: 'CRONÔMETRO'
  };

  function phaseLabel(view) {
    if (view.mode === 'countdown' && view.phase === 'work') return 'TIMER';
    if (view.mode === 'rounds' && view.phase === 'work') return 'ROLA!';
    return PHASE_LABELS[view.phase] || '';
  }

  /**
   * Resultado da luta pelo critério simplificado:
   * pontos > vantagens > menos punições. Retorna 'a', 'b' ou null (empate).
   */
  function matchLeader(match) {
    var a = match.a, b = match.b;
    if (a.points !== b.points) return a.points > b.points ? 'a' : 'b';
    if (a.advantages !== b.advantages) return a.advantages > b.advantages ? 'a' : 'b';
    if (a.penalties !== b.penalties) return a.penalties < b.penalties ? 'a' : 'b';
    return null;
  }

  return {
    MODES: MODES,
    LIMITS: LIMITS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    elapsedOf: elapsedOf,
    segmentsOf: segmentsOf,
    totalOf: totalOf,
    computeView: computeView,
    formatMs: formatMs,
    formatView: formatView,
    phaseLabel: phaseLabel,
    matchLeader: matchLeader
  };
});
