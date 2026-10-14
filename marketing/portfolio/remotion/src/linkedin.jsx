import React from 'react';
import {
  AbsoluteFill,
  Composition,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import timeline from '../generated/timeline.json';
import { AnimatedText, textEasing } from './motion.jsx';

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const PAPER = '#eaebe6';
const SURFACE = '#e1e3dc';
const INK = '#0c0f0d';
const MUTED = '#4b534e';
const RULE = '#c6c9c1';
const GREEN = '#12b24c';

const EASE = textEasing;
const DURATIONS = {
  cover: 90,
  concurrency: 240,
  pipeline: 300,
  atomicity: 240,
  round: 270,
  reconciliation: 210,
  replay: 450,
  after: 210,
  lifecycle: 300,
  wallet: 210,
  admission: 180,
  grafana: 360,
  outro: 150,
};
const TOTAL_FRAMES = Object.values(DURATIONS).reduce((sum, duration) => sum + duration, 0);
const asset = (name) => staticFile(`generated/linkedin/${name}`);

const FONT_CSS = `
@font-face{font-family:Archivo;src:url("${asset('fonts/archivo-400.woff2')}") format("woff2");font-weight:400;font-style:normal}
@font-face{font-family:Archivo;src:url("${asset('fonts/archivo-600.woff2')}") format("woff2");font-weight:600;font-style:normal}
@font-face{font-family:ArchivoBlack;src:url("${asset('fonts/archivo-black-400.woff2')}") format("woff2");font-weight:400;font-style:normal}
@font-face{font-family:JetBrainsMono;src:url("${asset('fonts/jetbrains-mono-400.woff2')}") format("woff2");font-weight:400;font-style:normal}
`;

function enter(frame, delay = 0, duration = 18) {
  return interpolate(frame, [delay, delay + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  });
}

function Reveal({ children, delay = 0, duration = 18, distance = 18, style = {} }) {
  const frame = useCurrentFrame();
  const progress = enter(frame, delay, duration);
  const transform = style.transform ?? '';
  const { transform: _transform, ...rest } = style;
  return (
    <div
      style={{
        ...rest,
        opacity: progress,
        transform: `${transform} translateY(${(1 - progress) * distance}px)`,
      }}
    >
      {children}
    </div>
  );
}

function Fonts() {
  return <style>{FONT_CSS}</style>;
}

function Frame({ section, children }) {
  return (
    <AbsoluteFill
      style={{ backgroundColor: PAPER, color: INK, fontFamily: 'Archivo, Arial, sans-serif' }}
    >
      <Fonts />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 45,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ width: 12, height: 12, backgroundColor: GREEN }} />
        <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: 0.4 }}>VINICIUS SPANOL</div>
      </div>
      <Img
        src={asset('subiu-logo.svg')}
        style={{
          position: 'absolute',
          right: 80,
          top: 36,
          width: 170,
          height: 56,
          objectFit: 'contain',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          top: 122,
          height: 3,
          backgroundColor: INK,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 1005,
          width: 1760,
          height: 2,
          backgroundColor: INK,
        }}
      />
      <div style={{ position: 'absolute', left: 80, top: 1021, fontSize: 25, fontWeight: 600 }}>
        jungle.subiu.dev
      </div>
      <div
        style={{
          position: 'absolute',
          right: 80,
          top: 1024,
          fontFamily: 'JetBrainsMono, monospace',
          color: MUTED,
          fontSize: 16,
          letterSpacing: 1.5,
        }}
      >
        DEMO · CRÉDITOS FICTÍCIOS
      </div>
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 155,
          fontFamily: 'JetBrainsMono, monospace',
          color: MUTED,
          fontSize: 19,
          letterSpacing: 1.7,
        }}
      >
        {section}
      </div>
      {children}
    </AbsoluteFill>
  );
}

function SceneFade({ children }) {
  const frame = useCurrentFrame();
  const opacity = enter(frame, 0, 14);
  const scale = interpolate(frame, [0, 26], [0.995, 1], {
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  return <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
}

function Cover() {
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, overflow: 'hidden' }}>
      <Img
        src={staticFile('generated/01-processador-1920x1080-base.png')}
        style={{ width: '100%', height: '100%' }}
      />
      {timeline.scenes[0].layers.map((layer) => (
        <AnimatedText key={layer.src} layer={layer} />
      ))}
    </AbsoluteFill>
  );
}

function Concurrency() {
  const frame = useCurrentFrame();
  const rowYs = [453, 573, 693];
  const card = { x: 916, y: 434, width: 330, height: 228 };
  const result = { x: 1320, y: 434, width: 520, height: 228 };
  const centerY = card.y + card.height / 2;
  const flow = (row) =>
    interpolate(frame, [30 + row * 10, 114 + row * 10], [-160, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE,
    });
  return (
    <Frame section="CENÁRIO DE TESTE · CONCORRÊNCIA E IDEMPOTÊNCIA">
      <SceneFade>
        <Reveal
          delay={3}
          style={{
            position: 'absolute',
            left: 80,
            top: 200,
            fontFamily: 'ArchivoBlack, Archivo, sans-serif',
            fontSize: 62,
            lineHeight: 1.06,
            maxWidth: 1600,
          }}
        >
          50 entregas. 3 processos. 1 débito.
        </Reveal>
        <Reveal
          delay={10}
          style={{ position: 'absolute', left: 82, top: 285, color: MUTED, fontSize: 29 }}
        >
          A mesma aposta chegou repetida e produziu um único efeito financeiro.
        </Reveal>
        <svg
          style={{ position: 'absolute', inset: 0, width: WIDTH, height: HEIGHT }}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-hidden="true"
        >
          <path
            d={rowYs
              .map((y) => `M360 ${y} H806 C862 ${y} 862 ${centerY} ${card.x} ${centerY}`)
              .join(' ')}
            fill="none"
            stroke={RULE}
            strokeWidth="4"
          />
          <path
            d={`M${card.x + card.width} ${centerY} H${result.x}`}
            fill="none"
            stroke={GREEN}
            strokeWidth="5"
            opacity={enter(frame, 125, 24)}
          />
        </svg>
        {['PROCESSO 01', 'PROCESSO 02', 'PROCESSO 03'].map((label, row) => (
          <Reveal
            key={label}
            delay={12 + row * 5}
            distance={0}
            style={{
              position: 'absolute',
              left: 80,
              top: rowYs[row] - 39,
              width: 280,
              height: 78,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 24,
              boxSizing: 'border-box',
              border: `2px solid ${INK}`,
              backgroundColor: PAPER,
              fontFamily: 'JetBrainsMono, monospace',
              fontSize: 19,
              letterSpacing: 1.1,
            }}
          >
            {label}
          </Reveal>
        ))}
        {[17, 17, 16].map((count, row) => (
          <div
            key={row}
            style={{
              position: 'absolute',
              left: 380,
              top: rowYs[row] - 6.5,
              width: 425,
              height: 50,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: flow(row),
                top: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(17, 15px)',
                columnGap: 9,
                rowGap: 9,
              }}
            >
              {Array.from({ length: count }, (_, index) => (
                <div
                  key={index}
                  style={{ width: 13, height: 13, backgroundColor: index % 5 === 0 ? INK : GREEN }}
                />
              ))}
            </div>
          </div>
        ))}
        <Reveal
          delay={25}
          distance={0}
          style={{
            position: 'absolute',
            left: card.x,
            top: card.y,
            width: card.width,
            height: card.height,
            boxSizing: 'border-box',
            border: `3px solid ${INK}`,
            backgroundColor: SURFACE,
            padding: '38px 32px',
          }}
        >
          <div
            style={{
              fontFamily: 'JetBrainsMono, monospace',
              color: MUTED,
              fontSize: 17,
              letterSpacing: 1.4,
            }}
          >
            CHAVE DA OPERAÇÃO
          </div>
          <div
            style={{
              marginTop: 25,
              fontFamily: 'ArchivoBlack, Archivo, sans-serif',
              fontSize: 28,
              lineHeight: 1.12,
            }}
          >
            IDEMPOTÊNCIA
          </div>
          <div style={{ marginTop: 17, fontSize: 22, color: MUTED }}>Uma aposta efetiva</div>
        </Reveal>
        <Reveal
          delay={125}
          duration={24}
          distance={0}
          style={{
            position: 'absolute',
            left: result.x,
            top: result.y,
            width: result.width,
            height: result.height,
            boxSizing: 'border-box',
            backgroundColor: GREEN,
            padding: '31px 36px',
          }}
        >
          <div style={{ fontFamily: 'JetBrainsMono, monospace', fontSize: 17, letterSpacing: 1.4 }}>
            RESULTADO PERSISTIDO
          </div>
          <div
            style={{ marginTop: 15, fontFamily: 'ArchivoBlack, Archivo, sans-serif', fontSize: 65 }}
          >
            1 DÉBITO
          </div>
          <div style={{ marginTop: 10, fontSize: 22 }}>Reenvios recuperam a resposta original.</div>
        </Reveal>
        <Reveal
          delay={80}
          style={{
            position: 'absolute',
            left: 80,
            top: 810,
            fontFamily: 'JetBrainsMono, monospace',
            color: MUTED,
            fontSize: 18,
            letterSpacing: 1.2,
          }}
        >
          ILUSTRAÇÃO DO ENSAIO DE CONCORRÊNCIA DOCUMENTADO
        </Reveal>
      </SceneFade>
    </Frame>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <>
      <Reveal
        delay={3}
        style={{
          position: 'absolute',
          left: 80,
          top: 205,
          fontFamily: 'ArchivoBlack, Archivo, sans-serif',
          fontSize: 60,
          lineHeight: 1.1,
          width: 1760,
        }}
      >
        {title}
      </Reveal>
      <Reveal
        delay={12}
        style={{
          position: 'absolute',
          left: 82,
          top: 292,
          color: MUTED,
          fontSize: 28,
          width: 1740,
          lineHeight: 1.4,
        }}
      >
        {subtitle}
      </Reveal>
    </>
  );
}

function Pipeline() {
  const frame = useCurrentFrame();
  const steps = [
    ['HTTP / SQS', 'Recebe o comando'],
    ['IDENTIDADE', 'Chave e hash do negócio'],
    ['LOCK DA WALLET', 'Lê e atualiza sob lock'],
    ['COMMIT', 'Confirma estado e eventos'],
    ['RESPOSTA / ACK', 'Somente depois do commit'],
  ];
  return (
    <Frame section="DO COMANDO À CONFIRMAÇÃO · FLUXO IMPLEMENTADO">
      <SceneFade>
        <SectionTitle
          title="Uma operação. Um caminho consistente."
          subtitle="Entrada HTTP ou SQS, identidade durável e concorrência coordenada no PostgreSQL."
        />
        <svg
          style={{ position: 'absolute', inset: 0, width: WIDTH, height: HEIGHT }}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {steps.slice(0, -1).map((_, i) => (
            <path
              key={i}
              d={`M${400 + i * 360} 512 H${440 + i * 360}`}
              stroke={GREEN}
              strokeWidth={5}
              opacity={enter(frame, 30 + i * 16, 18)}
            />
          ))}
        </svg>
        {steps.map(([title, detail], i) => (
          <Reveal
            key={title}
            delay={20 + i * 16}
            distance={0}
            style={{
              position: 'absolute',
              left: 80 + i * 360,
              top: 430,
              width: 320,
              height: 164,
              boxSizing: 'border-box',
              backgroundColor: i === 3 ? GREEN : SURFACE,
              border: `2px solid ${INK}`,
              padding: '30px 22px',
            }}
          >
            <div style={{ fontFamily: 'JetBrainsMono, monospace', fontSize: 20, fontWeight: 600 }}>
              {title}
            </div>
            <div style={{ fontSize: 25, lineHeight: 1.25, marginTop: 18 }}>{detail}</div>
          </Reveal>
        ))}
        <Reveal
          delay={100}
          style={{
            position: 'absolute',
            left: 80,
            top: 660,
            width: 860,
            padding: 28,
            boxSizing: 'border-box',
            borderLeft: `8px solid ${GREEN}`,
            backgroundColor: SURFACE,
            fontSize: 26,
            lineHeight: 1.4,
          }}
        >
          <strong>Outbox durável → publisher → SQS de eventos.</strong>
          <br />
          Falha no envio conserva o evento para nova tentativa.
        </Reveal>
        <Reveal
          delay={118}
          style={{
            position: 'absolute',
            left: 1010,
            top: 660,
            width: 830,
            fontSize: 26,
            lineHeight: 1.45,
            color: MUTED,
          }}
        >
          Falha na resposta ou no ACK: o reenvio recupera o resultado persistido. Locks por
          identidade e carteira preservam o paralelismo entre wallets.
        </Reveal>
        <Reveal
          delay={140}
          style={{
            position: 'absolute',
            left: 80,
            top: 894,
            fontFamily: 'JetBrainsMono, monospace',
            fontSize: 17,
            color: MUTED,
          }}
        >
          FLUXO DOCUMENTADO EM ARCHITECTURE.md · ILUSTRAÇÃO DA IMPLEMENTAÇÃO
        </Reveal>
      </SceneFade>
    </Frame>
  );
}

function Lifecycle() {
  const operations = [
    ['BET', 'Debita a aposta', 'Identidade única do comando.'],
    ['WIN', 'Credita o prêmio', 'Retorna à mesma carteira.'],
    ['LOSS', 'Registra a perda', 'Sem novo movimento de saldo.'],
    ['REFUND', 'Estorna a BET', 'Valor integral da aposta original.'],
    ['ROLLBACK', 'Reverte o efeito', 'Ligado à operação processada.'],
  ];
  return (
    <Frame section="CICLO FINANCEIRO · OPERAÇÕES DO PROCESSADOR">
      <SceneFade>
        <SectionTitle
          title="Da aposta à liquidação e à reversão."
          subtitle="Os movimentos ficam auditáveis e as referências financeiras são validadas."
        />
        {operations.map(([kind, title, detail], i) => (
          <Reveal
            key={kind}
            delay={20 + i * 12}
            style={{
              position: 'absolute',
              left: 80 + i * 360,
              top: 420,
              width: 320,
              height: 310,
              boxSizing: 'border-box',
              border: `2px solid ${INK}`,
              backgroundColor: SURFACE,
              padding: 26,
            }}
          >
            <div
              style={{
                fontFamily: 'JetBrainsMono, monospace',
                fontSize: 27,
                color: GREEN,
                fontWeight: 600,
              }}
            >
              {kind}
            </div>
            <div
              style={{
                fontFamily: 'ArchivoBlack, Archivo, sans-serif',
                fontSize: 30,
                marginTop: 32,
                lineHeight: 1.15,
              }}
            >
              {title}
            </div>
            <div style={{ fontSize: 23, marginTop: 25, lineHeight: 1.35, color: MUTED }}>
              {detail}
            </div>
          </Reveal>
        ))}
        <Reveal
          delay={95}
          style={{
            position: 'absolute',
            left: 80,
            top: 800,
            width: 1760,
            fontSize: 29,
            lineHeight: 1.4,
          }}
        >
          Dinheiro exato com Money e BigInt. Resultados terminais preservados para replay histórico.
        </Reveal>
        <Reveal
          delay={110}
          style={{
            position: 'absolute',
            left: 80,
            top: 896,
            width: 1760,
            fontFamily: 'JetBrainsMono, monospace',
            fontSize: 17,
            color: MUTED,
          }}
        >
          CAPACIDADES DOCUMENTADAS · O REPLAY GRAVADO DEMONSTRA UMA BET
        </Reveal>
      </SceneFade>
    </Frame>
  );
}

function Historical({ name }) {
  // The encoded excerpts retain the original Remotion text animation and real frames.
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      <OffthreadVideo src={asset(`${name}.mp4`)} muted style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          left: 1134,
          top: 955,
          fontFamily: 'JetBrainsMono, monospace',
          fontSize: 15,
          color: MUTED,
          backgroundColor: PAPER,
          padding: '2px 6px',
        }}
      >
        CAPTURA REAL · 07/10/2026 · RECORTE HISTÓRICO
      </div>
    </AbsoluteFill>
  );
}

function Round() {
  const layers = timeline.scenes.find((scene) => scene.id === '01-app').layers;
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      <Img
        src={staticFile('generated/01-app-base.png')}
        style={{ width: '100%', height: '100%' }}
      />
      <OffthreadVideo
        src={asset('round-game.mp4')}
        muted
        style={{
          position: 'absolute',
          left: 118,
          top: 128,
          width: 892,
          height: 892,
          objectFit: 'contain',
        }}
      />
      {layers.map((layer) => (
        <AnimatedText key={layer.src} layer={layer} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 1134,
          top: 955,
          fontFamily: 'JetBrainsMono, monospace',
          fontSize: 15,
          color: MUTED,
          backgroundColor: PAPER,
          padding: '2px 6px',
        }}
      >
        RODADA GRAVADA · 07/10/2026
      </div>
    </AbsoluteFill>
  );
}

function AfterReplay() {
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      <OffthreadVideo
        src={asset('after-replay.mp4')}
        muted
        style={{ width: '100%', height: '100%' }}
      />
      <AfterReplayOverlay />
    </AbsoluteFill>
  );
}

function AfterReplayOverlay() {
  const layers = timeline.scenes.find((scene) => scene.id === '02-reconciliation').layers;
  return (
    <AbsoluteFill>
      <Fonts />
      {layers.map((layer) => (
        <AnimatedText key={layer.src} layer={layer} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 1134,
          top: 690,
          width: 700,
          backgroundColor: PAPER,
          padding: '8px 0',
          fontFamily: 'JetBrainsMono, monospace',
          fontSize: 18,
          color: INK,
        }}
      >
        CONSULTA POSTERIOR AO REPLAY
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1134,
          top: 955,
          fontFamily: 'JetBrainsMono, monospace',
          fontSize: 15,
          color: MUTED,
          backgroundColor: PAPER,
          padding: '2px 6px',
        }}
      >
        CAPTURA REAL · 07/10/2026 · MESMA CARTEIRA
      </div>
    </AbsoluteFill>
  );
}

function Atomicity() {
  const entries = ['Saldo', 'Transação', 'Ledger', 'Inbox', 'Outbox'];
  return (
    <Frame section="PROCESSAMENTO FINANCEIRO · POSTGRESQL">
      <SceneFade>
        <Reveal
          delay={2}
          style={{
            position: 'absolute',
            left: 80,
            top: 205,
            fontFamily: 'ArchivoBlack, Archivo, sans-serif',
            fontSize: 64,
          }}
        >
          Consistência em uma transação.
        </Reveal>
        <Reveal
          delay={10}
          style={{ position: 'absolute', left: 82, top: 290, color: MUTED, fontSize: 29 }}
        >
          Commit financeiro único. Falha antes da confirmação faz rollback do conjunto.
        </Reveal>
        <div
          style={{
            position: 'absolute',
            left: 80,
            top: 390,
            width: 1760,
            height: 394,
            border: `2px solid ${RULE}`,
            boxSizing: 'border-box',
          }}
        />
        <Reveal
          delay={14}
          style={{
            position: 'absolute',
            left: 112,
            top: 414,
            fontFamily: 'JetBrainsMono, monospace',
            color: MUTED,
            fontSize: 18,
            letterSpacing: 1.4,
          }}
        >
          UMA ÚNICA TRANSAÇÃO POSTGRESQL
        </Reveal>
        {entries.map((entry, index) => (
          <Reveal
            key={entry}
            delay={22 + index * 9}
            duration={20}
            distance={22}
            style={{
              position: 'absolute',
              left: 112 + index * 343,
              top: 475,
              width: 296,
              height: 210,
              boxSizing: 'border-box',
              backgroundColor: SURFACE,
              border: `2px solid ${INK}`,
              padding: '31px 25px',
            }}
          >
            <div style={{ width: 15, height: 15, backgroundColor: GREEN }} />
            <div
              style={{
                marginTop: 30,
                fontFamily: 'ArchivoBlack, Archivo, sans-serif',
                fontSize: 34,
              }}
            >
              {entry}
            </div>
            <div
              style={{
                marginTop: 34,
                fontFamily: 'JetBrainsMono, monospace',
                color: MUTED,
                fontSize: 15,
                letterSpacing: 1.1,
              }}
            >
              PERSISTIDO
            </div>
          </Reveal>
        ))}
        <Reveal
          delay={70}
          style={{
            position: 'absolute',
            left: 700,
            top: 710,
            width: 520,
            height: 66,
            backgroundColor: GREEN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'JetBrainsMono, monospace',
            fontSize: 22,
            letterSpacing: 2,
          }}
        >
          COMMIT
        </Reveal>
        <Reveal
          delay={86}
          style={{ position: 'absolute', left: 80, top: 835, fontSize: 24, color: MUTED }}
        >
          Reenvios consultam o resultado persistido. Sem repetir o efeito financeiro.
        </Reveal>
      </SceneFade>
    </Frame>
  );
}

function CurrentWallet() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, DURATIONS.wallet], [1, 1.015], {
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  return (
    <Frame section="AUDITORIA DA CARTEIRA · CAPTURA ATUAL">
      <SceneFade>
        <Reveal
          delay={3}
          style={{
            position: 'absolute',
            left: 80,
            top: 200,
            fontFamily: 'ArchivoBlack, Archivo, sans-serif',
            fontSize: 60,
            width: 1000,
            lineHeight: 1.12,
          }}
        >
          Cada movimento pode ser conferido.
        </Reveal>
        <Reveal
          delay={11}
          style={{
            position: 'absolute',
            left: 82,
            top: 390,
            color: MUTED,
            fontSize: 30,
            width: 900,
            lineHeight: 1.4,
          }}
        >
          A consulta compara o saldo da carteira com a soma do ledger. Créditos e débitos permanecem
          ligados às operações.
        </Reveal>
        <div
          style={{
            position: 'absolute',
            left: 1180,
            top: 195,
            width: 570,
            height: 760,
            overflow: 'hidden',
            border: `3px solid ${INK}`,
            boxSizing: 'border-box',
            backgroundColor: PAPER,
          }}
        >
          <Img
            src={asset('wallet-ledger-current.png')}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 570,
              height: 'auto',
              transform: `translate(-50%, -50%) scale(${zoom})`,
              objectFit: 'contain',
            }}
          />
        </div>
        <Reveal
          delay={22}
          style={{
            position: 'absolute',
            left: 82,
            top: 890,
            fontFamily: 'JetBrainsMono, monospace',
            color: MUTED,
            fontSize: 17,
            letterSpacing: 1.3,
          }}
        >
          CONSULTA REAL · 14/10/2026 · CRÉDITOS FICTÍCIOS
        </Reveal>
        <Reveal
          delay={30}
          style={{
            position: 'absolute',
            left: 82,
            top: 610,
            width: 900,
            backgroundColor: SURFACE,
            padding: 30,
            boxSizing: 'border-box',
            borderLeft: `8px solid ${GREEN}`,
            fontSize: 27,
            lineHeight: 1.45,
          }}
        >
          <strong>Diferença R$ 0,00 na carteira consultada.</strong>
          <br />A captura mostra 1.421 lançamentos. É uma observação desta carteira, não de toda a
          sessão.
        </Reveal>
      </SceneFade>
    </Frame>
  );
}

function Admission() {
  const frame = useCurrentFrame();
  const progress = enter(frame, 16, 24);
  const x = interpolate(progress, [0, 1], [54, 0]);
  const scale = interpolate(progress, [0, 1], [0.97, 1]);
  return (
    <Frame section="ADMISSÃO CONFIGURÁVEL POR RODADA">
      <SceneFade>
        <Reveal
          delay={5}
          style={{
            position: 'absolute',
            left: 80,
            top: 236,
            fontFamily: 'ArchivoBlack, Archivo, sans-serif',
            fontSize: 66,
            lineHeight: 1.08,
            width: 810,
          }}
        >
          1.500 carteiras. Entrada com prazo.
        </Reveal>
        <Reveal
          delay={16}
          style={{
            position: 'absolute',
            left: 84,
            top: 450,
            fontSize: 29,
            color: MUTED,
            lineHeight: 1.35,
            width: 760,
          }}
        >
          Cada jogador tem sua carteira. A janela de entrada fecha em cinco segundos.
        </Reveal>
        <Reveal
          delay={26}
          style={{
            position: 'absolute',
            left: 84,
            top: 635,
            width: 620,
            height: 120,
            boxSizing: 'border-box',
            borderLeft: `10px solid ${GREEN}`,
            backgroundColor: SURFACE,
            padding: '25px 30px',
          }}
        >
          <div
            style={{
              fontFamily: 'JetBrainsMono, monospace',
              fontSize: 16,
              color: MUTED,
              letterSpacing: 1.1,
            }}
          >
            CONFIGURAÇÃO DA DEMO
          </div>
          <div
            style={{ marginTop: 13, fontFamily: 'ArchivoBlack, Archivo, sans-serif', fontSize: 31 }}
          >
            BET tardia → REFUND integral
          </div>
        </Reveal>
        <Img
          src={asset('round-configuration.png')}
          style={{
            position: 'absolute',
            left: 1050 + x,
            top: 164,
            width: 650,
            height: 812,
            objectFit: 'contain',
            transform: `scale(${scale})`,
            transformOrigin: 'center top',
            opacity: progress,
          }}
        />
      </SceneFade>
    </Frame>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const progress = enter(frame, 8, 24);
  return (
    <AbsoluteFill
      style={{ backgroundColor: PAPER, color: INK, fontFamily: 'Archivo, Arial, sans-serif' }}
    >
      <Fonts />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 49,
          width: 12,
          height: 12,
          backgroundColor: GREEN,
        }}
      />
      <div style={{ position: 'absolute', left: 110, top: 37, fontSize: 25, fontWeight: 600 }}>
        VINICIUS SPANOL
      </div>
      <Img
        src={asset('subiu-logo.svg')}
        style={{
          position: 'absolute',
          right: 80,
          top: 36,
          width: 170,
          height: 56,
          objectFit: 'contain',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          top: 122,
          height: 3,
          backgroundColor: INK,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 190,
          fontFamily: 'JetBrainsMono, monospace',
          color: MUTED,
          fontSize: 19,
          letterSpacing: 1.7,
        }}
      >
        ENGENHARIA APLICADA · PROCESSADOR DE APOSTAS
      </div>
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 296,
          fontFamily: 'ArchivoBlack, Archivo, sans-serif',
          fontSize: 76,
          lineHeight: 1.08,
          width: 1640,
          opacity: progress,
          transform: `translateY(${(1 - progress) * 18}px)`,
        }}
      >
        Concorrência sob controle.
      </div>
      <div
        style={{
          position: 'absolute',
          left: 86,
          top: 535,
          display: 'flex',
          gap: 20,
          opacity: progress,
        }}
      >
        {['IDEMPOTÊNCIA', 'ATOMICIDADE', 'OBSERVABILIDADE'].map((text) => (
          <div
            key={text}
            style={{
              border: `2px solid ${INK}`,
              padding: '18px 20px',
              fontFamily: 'JetBrainsMono, monospace',
              fontSize: 17,
              letterSpacing: 0.8,
            }}
          >
            {text}
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 694,
          width: 990,
          height: 4,
          backgroundColor: GREEN,
          transform: `scaleX(${progress})`,
          transformOrigin: 'left',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 750,
          fontSize: 30,
          color: MUTED,
          opacity: progress,
        }}
      >
        Uma demo de portfólio com créditos fictícios.
      </div>
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 1005,
          width: 1760,
          height: 2,
          backgroundColor: INK,
        }}
      />
      <div style={{ position: 'absolute', left: 80, top: 1021, fontSize: 25, fontWeight: 600 }}>
        jungle.subiu.dev
      </div>
      <div
        style={{
          position: 'absolute',
          right: 80,
          top: 1024,
          fontFamily: 'JetBrainsMono, monospace',
          color: MUTED,
          fontSize: 16,
          letterSpacing: 1.5,
        }}
      >
        DEMO · CRÉDITOS FICTÍCIOS
      </div>
    </AbsoluteFill>
  );
}

function LinkedInMasterpiece() {
  let from = 0;
  const scenes = [
    [Cover, DURATIONS.cover],
    [Concurrency, DURATIONS.concurrency],
    [Pipeline, DURATIONS.pipeline],
    [Atomicity, DURATIONS.atomicity],
    [Round, DURATIONS.round],
    [() => <Historical name="reconciliation" />, DURATIONS.reconciliation],
    [() => <Historical name="replay" />, DURATIONS.replay],
    [AfterReplay, DURATIONS.after],
    [Lifecycle, DURATIONS.lifecycle],
    [CurrentWallet, DURATIONS.wallet],
    [Admission, DURATIONS.admission],
    [() => <Historical name="grafana" />, DURATIONS.grafana],
    [Outro, DURATIONS.outro],
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      {scenes.map(([Component, duration], index) => {
        const start = from;
        from += duration;
        return (
          <Sequence key={index} from={start} durationInFrames={duration}>
            <Component />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function Root() {
  return (
    <>
      <Composition
        id="LinkedInMasterpiece"
        component={LinkedInMasterpiece}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="LinkedInAfterOverlay"
        component={AfterReplayOverlay}
        durationInFrames={DURATIONS.after}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
}

registerRoot(Root);
