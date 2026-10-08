/*
 * Sons gerados com Web Audio (sem arquivos de áudio).
 * Navegadores só liberam o áudio depois de uma interação do usuário,
 * por isso a TV pede um "OK" inicial e chama `unlock()`.
 */
(function (root) {
  'use strict';

  var ctx = null;

  function unlock() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    } catch (e) {
      return false; // alguns navegadores de TV falham ao criar o áudio
    }
    return true;
  }

  function tone(freq, start, duration, type, volume) {
    if (!ctx) return;
    var t0 = ctx.currentTime + start;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume || 0.35, t0 + 0.01);
    gain.gain.setValueAtTime(volume || 0.35, t0 + duration - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  var sounds = {
    // Bip curto da contagem 3, 2, 1.
    tick: function () { tone(880, 0, 0.15, 'sine', 0.5); },
    // Aviso de 10 segundos: dois bips.
    warn: function () { tone(1320, 0, 0.12, 'square'); tone(1320, 0.2, 0.12, 'square'); },
    // Início do round/luta: bip longo e agudo.
    start: function () { tone(1046, 0, 0.7, 'square', 0.4); },
    // Início do descanso: dois tons descendo.
    rest: function () { tone(660, 0, 0.3, 'triangle', 0.5); tone(440, 0.35, 0.5, 'triangle', 0.5); },
    // Fim: buzina.
    end: function () {
      tone(220, 0, 1.2, 'sawtooth', 0.35);
      tone(277, 0, 1.2, 'sawtooth', 0.25);
    }
  };

  function play(name) {
    if (!ctx || !sounds[name]) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    sounds[name]();
  }

  root.BJJSound = { unlock: unlock, play: play, isReady: function () { return !!ctx && ctx.state === 'running'; } };
})(this);
