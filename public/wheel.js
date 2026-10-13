/*
 * Roleta desenhada em SVG (TV). Escrita em ES5 para navegadores de TV antigos.
 *
 * A seta fica fixa no topo; o disco gira no sentido horário. Todos os aparelhos
 * calculam o mesmo ângulo final a partir do giro ({id, index}), então a TV pode
 * recarregar no meio do giro sem perder o resultado.
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var R = 96;          // raio do disco (viewBox -100..100)
  var TURNS = 6;       // voltas completas antes de parar
  // Curva da animação (easeOutCubic); a mesma fórmula calcula quando cada fatia passa pela seta.
  var EASING = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function point(r, deg) {
    var rad = deg * Math.PI / 180;
    return (r * Math.sin(rad)).toFixed(3) + ' ' + (-r * Math.cos(rad)).toFixed(3);
  }

  function setTransform(node, angle, ms) {
    var transition = ms ? 'transform ' + ms + 'ms ' + EASING : 'none';
    node.style.webkitTransition = ms ? '-webkit-transform ' + ms + 'ms ' + EASING : 'none';
    node.style.transition = transition;
    node.style.webkitTransform = 'rotate(' + angle + 'deg)';
    node.style.transform = 'rotate(' + angle + 'deg)';
  }

  // Pequena variação dentro da fatia (igual em todos os aparelhos: depende só do id do giro).
  function jitter(id) {
    var x = Math.sin(id * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) - 0.5; // -0.5..0.5
  }

  function create(container) {
    var rotor = document.createElement('div');
    rotor.className = 'wheel-rotor';
    var svg = el('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true' });
    rotor.appendChild(svg);
    container.appendChild(rotor);

    var pointer = document.createElement('div');
    pointer.className = 'wheel-pointer';
    container.appendChild(pointer);

    var hub = document.createElement('div');
    hub.className = 'wheel-hub';
    hub.innerHTML = '<i></i><i></i><i></i><i></i>'; // as barras das faixas
    container.appendChild(hub);

    var key = null;
    var sectors = [];
    var angle = 0;
    var lastSpinId = null;
    var timers = [];

    function draw(options) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      sectors = [];
      var n = options.length;
      var s = 360 / n;
      for (var i = 0; i < n; i++) {
        var a0 = i * s, a1 = (i + 1) * s;
        var g = el('g', { 'class': 'wheel-sector' }, svg);
        el('path', {
          d: 'M0 0 L' + point(R, a0) + ' A' + R + ' ' + R + ' 0 ' + (s > 180 ? 1 : 0) + ' 1 ' + point(R, a1) + ' Z'
        }, g);
        // Texto ao longo do raio (a orientação é acertada em orient()).
        var label = options[i].toUpperCase();
        var size = Math.min(13, 64 / (label.length * 0.42), 0.42 * (2 * Math.PI * 58 / n));
        var text = el('text', {
          'font-size': size.toFixed(2),
          'text-anchor': 'middle',
          'dominant-baseline': 'central'
        }, g);
        text.textContent = label;
        g._mid = a0 + s / 2;
        g._text = text;
        sectors.push(g);
      }
      el('circle', { r: R, 'class': 'wheel-rim' }, svg);
    }

    // Com a roleta parada, os nomes que ficaram na metade esquerda da tela giram 180°
    // para não aparecerem de cabeça para baixo.
    function orient(rotation) {
      for (var i = 0; i < sectors.length; i++) {
        var mid = sectors[i]._mid;
        var screen = ((mid + rotation) % 360 + 360) % 360;
        var left = screen > 180;
        sectors[i]._text.setAttribute('x', left ? -60 : 60);
        sectors[i]._text.setAttribute('transform', 'rotate(' + (left ? mid + 90 : mid - 90) + ')');
      }
    }

    function clearTimers() {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
    }

    function highlight(index) {
      for (var i = 0; i < sectors.length; i++) {
        sectors[i].setAttribute('class', 'wheel-sector' + (i === index ? ' win' : ''));
      }
    }

    function targetAngle(index, n, id) {
      var s = 360 / n;
      // Fatia `index` com o centro (± variação) embaixo da seta: ângulo ≡ -(index + 0.5 + j)·s
      var aim = -(index + 0.5 + jitter(id) * 0.6) * s;
      var delta = ((aim - angle) % 360 + 360) % 360;
      return angle + TURNS * 360 + delta;
    }

    return {
      /** Redesenha só quando a lista muda. */
      setOptions: function (options) {
        var k = options.join('\n');
        if (k === key) return;
        key = k;
        clearTimers();
        draw(options);
        angle = 0;
        lastSpinId = null;
        setTransform(rotor, 0, 0);
        orient(0);
      },

      /**
       * Mostra o giro. `elapsed` = ms desde o início do giro (relógio da TV).
       * Chama onTick a cada fatia que passa pela seta e onReveal ao parar.
       */
      spin: function (spin, elapsed, duration, onTick, onReveal) {
        if (!spin || spin.id === lastSpinId || spin.index >= sectors.length) return;
        lastSpinId = spin.id;
        clearTimers();
        var from = angle;
        var to = targetAngle(spin.index, sectors.length, spin.id);
        angle = to;
        var remaining = duration - elapsed;
        if (remaining <= 50) { // giro antigo (ex.: a TV recarregou): já mostra parado
          setTransform(rotor, to, 0);
          orient(to);
          highlight(spin.index);
          return;
        }
        highlight(-1);
        setTransform(rotor, from, 0);
        void rotor.offsetWidth; // aplica o ângulo inicial antes da transição
        setTransform(rotor, to, remaining);

        // Tic: a seta cruza uma divisa a cada múltiplo de s graus.
        // easeOutCubic: p = 1 - (1 - t)^3  ⇒  t = 1 - (1 - p)^(1/3)
        var s = 360 / sectors.length;
        var last = -1000;
        for (var m = Math.ceil(from / s); m * s <= to; m++) {
          var p = (m * s - from) / (to - from);
          var t = remaining * (1 - Math.pow(1 - p, 1 / 3));
          if (t - last < 70) continue; // no começo as fatias passam rápido demais
          last = t;
          timers.push(setTimeout(onTick, t));
        }
        timers.push(setTimeout(function () {
          orient(to);
          highlight(spin.index);
          if (onReveal) onReveal();
        }, remaining));
      }
    };
  }

  root.BJJWheel = { create: create };
})(this);
