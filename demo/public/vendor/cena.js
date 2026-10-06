/*
 * Cena do jogo de multiplicador: fundo, raios, curva e personagem.
 *
 * **Canvas 2D e nada mais.** Não há PixiJS aqui, e a decisão é de tamanho: o que esta cena desenha
 * são dezoito cunhas, uma área preenchida, uma linha, um sprite tingido (ou os quatro polígonos de
 * reserva) e, desde a onda 17, as três formas do estouro. Um motor de WebGL para isso custaria uns 400 KB vendorizados dentro de
 * `wwwroot` para desenhar o que o 2D desenha a 60 fps num notebook velho. A onda 9 anotou que "o
 * dia em que houver partículas a conversa muda"; o dia chegou, as partículas são vinte e uma formas
 * geradas por código e o orçamento de quadro foi medido, e a conversa não mudou.
 *
 * **Nada aqui decide o jogo.** A cena recebe o quadro pronto — fase, segundos de voo, multiplicador
 * — e só o pinta. Quem sabe onde a curva estoura é o servidor, e este arquivo nem tem como saber.
 */

/** Cor do token da marca, lida do CSS para o canvas não ter uma segunda paleta. */
function token(nome, padrao) {
  const valor = getComputedStyle(document.body).getPropertyValue(nome).trim();

  return valor || padrao;
}

/** `#rrggbb` para `rgba(r,g,b,a)`, que é o que o canvas quer quando a cor tem alfa. */
function alfa(hex, a) {
  const limpo = hex.replace('#', '');
  const cheio = limpo.length === 3 ? [...limpo].map((c) => c + c).join('') : limpo;
  const n = parseInt(cheio, 16);

  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * As três formas do estouro, geradas por código: faísca, fumaça e brilho.
 *
 * **Nenhum PNG e nenhum motor.** O inventário da `02-referencia-visual.md` previa "3 a 5 PNG de
 * fumaça e faísca"; um arquivo de fumaça seria um arquivo por marca (a fumaça pega a cor da casa) e
 * um motor de partículas seria o caminhão da nota lá em cima. As três formas cabem em trinta linhas
 * de canvas 2D:
 *
 *   - **faísca**: um risco curto na direção do próprio movimento, que é o que o olho lê como
 *     velocidade. Doze delas, num leque para cima e para a frente, com gravidade puxando;
 *   - **fumaça**: um círculo mole que cresce e apaga, oito deles, subindo devagar e girando;
 *   - **brilho**: um clarão radial só, no ponto do estouro, que dura um terço do resto.
 *
 * **Vida de 0,6 s**, a mesma da saída do herói: as duas coisas são o mesmo evento, e uma fumaça que
 * durasse mais ficaria no ar depois de a tela já ter escrito o multiplicador em vermelho.
 *
 * **Vinte e uma formas e não duzentas.** O orçamento é o retrato de um telefone, e ele foi medido:
 * a onda 17 exige não cair abaixo de 55 fps em 390×844 durante os 0,6 s. Cada quadro aqui é um
 * `arc` ou dois `lineTo`, sem sombra e sem gradiente por partícula. O único gradiente é o do
 * brilho, e ele é um.
 */
const PARTICULAS = { faiscas: 12, fumacas: 8, vida: 0.6 };

/**
 * O sprite do herói, e a razão de ele ser um arquivo só.
 *
 * A onda 9 desenhou o avião em quatro polígonos e deixou o motivo escrito: um sprite exigiria um
 * arquivo por marca, porque o herói sai na cor de destaque da casa. O que muda aqui é o método, e
 * não a regra: o PNG é uma **librê neutra** (branco, cinza claro e grafite escuro, gerada para a
 * casa, ver `docs/games/05-heroi-decolagem.md`), e é o canvas que a pinta com o `--marca` da
 * página, uma vez por cor, num canvas fora da tela. Uma marca nova continua ganhando o herói na cor
 * dela sem ninguém abrir um editor, e o avião passou a ter volume.
 *
 * **Os polígonos ficam como reserva.** Enquanto o arquivo não chega, ou se ele nunca chegar, a cena
 * desenha o delta da onda 9, na mesma posição e com a mesma escala. É a regra dos sprites do
 * caça-níquel: um cliente de jogo que depende de download para desenhar a tela precisa de um
 * desenho que não depende de download.
 *
 * O número no endereço é o mesmo truque do `sprites.js` do slot: `/play/…/sprites/` sai com
 * `no-cache`, mas a Cloudflare reescreve para quatro horas; trocar a arte sem subir este número
 * deixaria a instalação pública com o avião velho. **Suba-o sempre que o arquivo mudar.**
 */
const VERSAO_DA_ARTE = '1';

class Heroi {
  constructor() {
    this.imagem = null;
    this.tingidos = new Map();

    const imagem = new Image();

    imagem.decoding = 'async';
    imagem.onload = () => (this.imagem = imagem);
    imagem.src = new URL(`./sprites/heroi.png?v=${VERSAO_DA_ARTE}`, import.meta.url).href;
  }

  /**
   * A imagem já na cor da casa. `multiply` sobre a librê branca dá a cor cheia onde o avião é claro
   * e deixa o grafite escuro; o `destination-in` no fim devolve o alfa do PNG, porque o `multiply`
   * do canvas compõe como `source-over` e pintaria o fundo transparente também.
   */
  tingido(clara) {
    let pronto = this.tingidos.get(clara);

    if (pronto) return pronto;

    pronto = document.createElement('canvas');
    pronto.width = this.imagem.naturalWidth;
    pronto.height = this.imagem.naturalHeight;

    const g = pronto.getContext('2d');

    g.drawImage(this.imagem, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = alfa(clara, 0.6);
    g.fillRect(0, 0, pronto.width, pronto.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.imagem, 0, 0);

    this.tingidos.set(clara, pronto);

    return pronto;
  }
}

class Estouro {
  constructor() {
    this.pecas = [];
    this.tempo = 0;
  }

  /** Acende o estouro no ponto em que a curva parou. Uma vez por rodada. */
  acender(x, y, escala) {
    this.pecas = [];
    this.tempo = 0;

    for (let i = 0; i < PARTICULAS.faiscas; i++) {
      // O leque vai para cima e para a frente, que é para onde o herói ia: uma explosão simétrica
      // pareceria um fogo de artifício e não um avião que se desfez.
      const angulo = -Math.PI * 0.75 + Math.random() * Math.PI * 0.9;
      const forca = (150 + Math.random() * 320) * escala;

      this.pecas.push({
        tipo: 'faisca',
        x,
        y,
        vx: Math.cos(angulo) * forca,
        vy: Math.sin(angulo) * forca,
        tamanho: (2 + Math.random() * 2.5) * escala,
        vida: 0.55 + Math.random() * 0.45,
      });
    }

    for (let i = 0; i < PARTICULAS.fumacas; i++) {
      const angulo = Math.random() * Math.PI * 2;
      const forca = (12 + Math.random() * 46) * escala;

      this.pecas.push({
        tipo: 'fumaca',
        x: x + Math.cos(angulo) * 6 * escala,
        y: y + Math.sin(angulo) * 6 * escala,
        vx: Math.cos(angulo) * forca,
        vy: Math.sin(angulo) * forca - 26 * escala,
        tamanho: (9 + Math.random() * 16) * escala,
        giro: Math.random() * Math.PI,
        vida: 0.7 + Math.random() * 0.3,
      });
    }

    this.pecas.push({ tipo: 'brilho', x, y, tamanho: 70 * escala, vida: 1 });
  }

  apagar() {
    this.pecas = [];
    this.tempo = 0;
  }

  /**
   * Um passo e o desenho, na mesma passada.
   *
   * Juntos porque a lista é curta e percorrê-la duas vezes seria duas vezes o mesmo laço; o que
   * custa num canvas 2D é o número de chamadas de desenho, e aqui elas são uma por peça.
   */
  desenhar(ctx, dt, marca, clara, perigo) {
    if (!this.pecas.length) return;

    this.tempo += dt;

    if (this.tempo >= PARTICULAS.vida) return this.apagar();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.pecas) {
      const t = this.tempo / (PARTICULAS.vida * p.vida);

      if (t >= 1) continue;

      if (p.tipo === 'brilho') {
        // O clarão dura um terço do resto: ele é o instante do estouro, não o rastro dele.
        const f = Math.max(0, 1 - t * 3);

        if (f <= 0) continue;

        const luz = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.tamanho * (1 + t * 2.2));

        luz.addColorStop(0, alfa(clara, 0.85 * f));
        luz.addColorStop(0.45, alfa(perigo, 0.35 * f));
        luz.addColorStop(1, alfa(marca, 0));
        ctx.fillStyle = luz;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.tamanho * (1 + t * 2.2), 0, Math.PI * 2);
        ctx.fill();

        continue;
      }

      // Gravidade e arrasto, os dois grosseiros de propósito: o que se lê aqui é o gesto, e um
      // integrador de verdade custaria a mesma coisa e não mudaria um pixel que alguém veja.
      const arrasto = 1 - Math.min(0.9, dt * (p.tipo === 'faisca' ? 1.6 : 2.4));

      p.vx *= arrasto;
      p.vy = p.vy * arrasto + (p.tipo === 'faisca' ? 620 : 40) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.tipo === 'faisca') {
        ctx.globalAlpha = (1 - t) ** 1.5;
        ctx.strokeStyle = t < 0.35 ? '#ffd9a0' : perigo;
        ctx.lineWidth = p.tamanho;
        ctx.lineCap = 'round';
        ctx.beginPath();
        // O risco é o próprio vetor de velocidade encolhido: quanto mais rápido, mais comprido, que
        // é o que o olho lê como velocidade sem ninguém desenhar um rastro de verdade.
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
        ctx.stroke();

        continue;
      }

      // A fumaça escurece em vez de acender: ela é a única peça que não soma luz.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.32 * (1 - t);
      ctx.fillStyle = t < 0.5 ? alfa(perigo, 0.5) : alfa(marca, 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.tamanho * (0.6 + t * 1.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
    }

    ctx.restore();

    return undefined;
  }
}

export class Cena {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.giro = 0;
    this.ultimo = 0;
    this.saida = 0;
    this.animacao = true;
    this.quadro = { fase: null, segundos: 0, multiplicador: 1 };
    this.estouro = new Estouro();
    this.sprite = new Heroi();

    const menos = matchMedia('(prefers-reduced-motion: reduce)');

    this.reduzido = menos.matches;
    menos.addEventListener('change', (e) => (this.reduzido = e.matches));

    new ResizeObserver(() => this.dimensionar()).observe(canvas.parentElement);
    this.dimensionar();
  }

  /** O canvas em pixels de verdade, para a linha da curva não sair borrada em tela retina. */
  dimensionar() {
    const escala = Math.min(devicePixelRatio || 1, 2);
    const { clientWidth: l, clientHeight: a } = this.canvas;

    this.canvas.width = Math.max(1, Math.round(l * escala));
    this.canvas.height = Math.max(1, Math.round(a * escala));
    this.ctx.setTransform(escala, 0, 0, escala, 0, 0);
    this.largura = l;
    this.altura = a;
  }

  /** Liga e desliga os raios pelo menu. O jogo continua igual; só a tela fica parada. */
  animar(ligada) {
    this.animacao = ligada;
  }

  /**
   * O quadro que a cena deve pintar da próxima vez. Quem chama é o laço do `jogo.js`, a 60 fps.
   *
   * `saida` é o único estado que a cena guarda sozinha: a fração dos 0,6 s em que o herói sai pela
   * direita depois do estouro. É animação pura e não tem nada a ver com o servidor, então guardá-la
   * aqui evita passar um número de enfeite em toda chamada.
   */
  desenhar(quadro, agora) {
    const dt = this.ultimo ? Math.min(0.1, (agora - this.ultimo) / 1000) : 0;

    this.ultimo = agora;

    if (this.animacao && !this.reduzido) this.giro += dt * 0.055;

    // O estouro acende uma vez, no quadro em que a fase vira `crashed`: `saida` ainda é zero ali, e
    // é ele que diz que este é o primeiro quadro da explosão.
    const acendeu = quadro.fase === 'crashed' && this.saida === 0 && this.quadro.fase !== 'crashed';

    if (quadro.fase === 'crashed') this.saida = Math.min(1, this.saida + dt / 0.6);
    else this.saida = 0;

    this.quadro = quadro;

    const { ctx, largura: L, altura: A } = this;

    ctx.clearRect(0, 0, L, A);
    this.fundo();

    if (quadro.fase === 'flying' || quadro.fase === 'crashed') this.curva(acendeu);

    // Com movimento reduzido não há explosão: quem pediu para a tela parar não pediu por doze
    // faíscas com gravidade. O clarão da cor e o número em vermelho continuam contando o que houve.
    if (!this.reduzido) {
      this.estouro.desenhar(
        ctx,
        dt,
        token('--marca', '#901bf7'),
        token('--marca-clara', '#a855f7'),
        token('--perigo', '#e8412b'),
      );
    }
  }

  /** Céu preto azulado com o brilho no meio e as cunhas girando devagar em cima. */
  fundo() {
    const { ctx, largura: L, altura: A } = this;
    const fundo = token('--cena-fundo', '#04060c');
    const brilho = token('--cena-brilho', '#16233d');

    const luz = ctx.createRadialGradient(
      L * 0.5,
      A * 0.52,
      0,
      L * 0.5,
      A * 0.52,
      Math.max(L, A) * 0.62,
    );

    luz.addColorStop(0, brilho);
    luz.addColorStop(1, fundo);
    ctx.fillStyle = luz;
    ctx.fillRect(0, 0, L, A);

    // Os raios saem do canto de baixo à esquerda, que é de onde a curva sai: o fundo aponta para
    // onde a atenção vai. Dezoito cunhas, uma sim uma não, girando um sexto de volta por minuto.
    const ox = -L * 0.02;
    const oy = A * 1.02;
    const raio = Math.hypot(L, A) * 1.25;
    const cunhas = 18;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';

    for (let i = 0; i < cunhas; i++) {
      const a0 = this.giro + (i * Math.PI * 2) / cunhas;
      const a1 = a0 + Math.PI / cunhas;

      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, raio, a0, a1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * A curva e o herói na ponta dela.
   *
   * A forma é a mesma do Aviator: sobe rápido nos primeiros segundos e depois encosta no canto de
   * cima, onde o herói fica bobeando enquanto o número continua subindo. Não é a curva do
   * multiplicador desenhada num eixo — isso mandaria o avião para fora da tela em vinte segundos —
   * é uma trajetória com o mesmo *ritmo*, que é o que a referência mostra.
   */
  curva(acendeu = false) {
    const { ctx, largura: L, altura: A } = this;
    const marca = token('--marca', '#901bf7');
    const clara = token('--marca-clara', '#a855f7');
    const t = Math.max(0, this.quadro.segundos);

    // Seis segundos até o canto, e depois só o balanço. `1 - e^(-t/2.2)` é a mesma família de curva
    // do jogo, o que faz a subida parecer a do número mesmo sem ser ele.
    const avanco = 1 - Math.exp(-t / 2.4);
    const px = 0.1 + avanco * 0.66;
    const py = 0.86 - avanco * 0.6;
    const balanco = this.reduzido ? 0 : Math.sin(t * 2.1) * 0.012 * Math.min(1, t / 3);

    // A ponta da curva é onde a rodada parou. O herói é que sai pela direita depois do estouro: se
    // a curva saísse junto, ela atravessaria a tela e o desenho contaria uma rodada que não houve.
    const fx = L * px;
    const hy = A * (py + balanco);
    const hx = fx + this.saida * L * 0.55;
    const x0 = L * 0.06;
    const y0 = A * 0.9;

    // A curva desenhada, com um controle abaixo da reta para ela sair côncava como a da referência.
    const trilha = new Path2D();

    trilha.moveTo(x0, y0);
    trilha.quadraticCurveTo(L * (0.06 + px) * 0.55, A * 0.9, fx, hy);

    const area = new Path2D(trilha);

    area.lineTo(fx, A);
    area.lineTo(x0, A);
    area.closePath();

    const preenche = ctx.createLinearGradient(0, hy, 0, A);

    preenche.addColorStop(0, alfa(marca, 0.32));
    preenche.addColorStop(1, alfa(marca, 0.02));
    ctx.fillStyle = preenche;
    ctx.fill(area);

    ctx.strokeStyle = this.quadro.fase === 'crashed' ? token('--perigo', '#e8412b') : clara;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(trilha);

    // A explosão nasce onde o herói estava, e com a escala dele: num telefone ela é menor porque a
    // cena é menor, e não porque alguém escreveu um segundo número.
    const escala = Math.min(1.35, Math.max(0.75, L / 900));

    if (acendeu && !this.reduzido) this.estouro.acender(fx, hy, escala);

    // Depois do estouro o herói sai pela direita em 0,6 s e leva a opacidade junto.
    if (this.saida >= 1) return;

    ctx.save();
    ctx.globalAlpha = 1 - this.saida;
    ctx.translate(hx, hy);
    ctx.rotate(-0.28 + this.saida * 0.5);
    this.heroi(ctx, escala);
    ctx.restore();
  }

  /**
   * O herói: o sprite tingido na cor da casa, ou os quatro polígonos da onda 9 enquanto ele não
   * chega. Os dois ocupam a mesma caixa (104×64 em unidades locais, o nariz em x = 96), então a
   * troca de um pelo outro não move a ponta da curva.
   */
  heroi(ctx, escala) {
    const clara = token('--marca-clara', '#a855f7');

    ctx.scale(escala, escala);
    ctx.shadowColor = alfa(clara, 0.55);
    ctx.shadowBlur = 22;

    if (this.sprite.imagem) {
      // O avião ocupa 85% da largura do quadro; com 124 de lado ele mede ~105, um pouco mais que
      // os ~92 dos polígonos, porque a fuselagem fina pesa menos na tela que o delta cheio. O
      // centro fica em (-2, 0), o mesmo da caixa deles, e o nariz continua na ponta da curva.
      ctx.drawImage(this.sprite.tingido(clara), -64, -62, 124, 124);

      return;
    }

    this.heroiPoligonos(ctx, clara);
  }

  /** O delta de asa alta da onda 9, os mesmos polígonos do `<g id="heroi">` do HTML. */
  heroiPoligonos(ctx, clara) {
    const marca = token('--marca', '#901bf7');

    ctx.translate(-52, -32);

    const poli = (pontos, cor) => {
      ctx.beginPath();
      ctx.moveTo(pontos[0][0], pontos[0][1]);
      for (const [x, y] of pontos.slice(1)) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fillStyle = cor;
      ctx.fill();
    };

    poli(
      [
        [4, 34],
        [28, 14],
        [34, 24],
        [18, 38],
      ],
      alfa(marca, 0.55),
    );
    poli(
      [
        [8, 46],
        [32, 36],
        [36, 44],
        [20, 52],
      ],
      alfa(marca, 0.4),
    );
    poli(
      [
        [10, 38],
        [62, 24],
        [96, 31],
        [62, 39],
        [18, 45],
      ],
      clara,
    );

    ctx.shadowBlur = 0;

    poli(
      [
        [58, 28],
        [80, 30],
        [74, 33],
        [56, 33],
      ],
      'rgba(255, 255, 255, 0.85)',
    );
  }

  /** A tela entre rodadas: só o fundo, sem curva e sem herói. */
  limpar() {
    this.saida = 0;
    this.quadro = { fase: null, segundos: 0, multiplicador: 1 };
    this.estouro.apagar();
  }
}
