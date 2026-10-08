/*
 * Modelos prontos de treino, usados pelo celular e pelo menu da TV.
 * Também carregado pelos testes em Node (todos precisam respeitar T.LIMITS).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BJJPresets = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    rounds: [
      { label: 'Combate 5 × 5 min', sub: 'descanso 1 min', s: { work: 300, rest: 60, rounds: 5, prep: 10 } },
      { label: 'Combate 6 × 6 min', sub: 'descanso 1 min', s: { work: 360, rest: 60, rounds: 6, prep: 10 } },
      { label: 'Combate rápido 8 × 3 min', sub: 'descanso 30 s', s: { work: 180, rest: 30, rounds: 8, prep: 10 } },
      { label: 'Drill 10 × 2 min', sub: 'troca 15 s', s: { work: 120, rest: 15, rounds: 10, prep: 10 } },
      { label: 'Tabata 8 × 20 s', sub: 'descanso 10 s', s: { work: 20, rest: 10, rounds: 8, prep: 10 } },
      { label: 'Circuito 10 × 45 s', sub: 'descanso 15 s', s: { work: 45, rest: 15, rounds: 10, prep: 10 } }
    ],
    // Tempos de luta adulto (referência IBJJF).
    match: [
      { label: 'Branca', sub: '5 min', s: { duration: 300 } },
      { label: 'Azul', sub: '6 min', s: { duration: 360 } },
      { label: 'Roxa', sub: '7 min', s: { duration: 420 } },
      { label: 'Marrom', sub: '8 min', s: { duration: 480 } },
      { label: 'Preta', sub: '10 min', s: { duration: 600 } },
      { label: 'Infantil', sub: '4 min', s: { duration: 240 } }
    ],
    countdown: [
      { label: '1 min', s: { duration: 60 } },
      { label: '2 min', s: { duration: 120 } },
      { label: '3 min', s: { duration: 180 } },
      { label: '5 min', s: { duration: 300 } },
      { label: '10 min', s: { duration: 600 } },
      { label: '15 min', s: { duration: 900 } }
    ]
  };
});
