export class Cena {
  constructor(canvas: HTMLCanvasElement);
  desenhar(
    quadro: { fase: string | null; segundos: number; multiplicador: number },
    agora: number,
  ): void;
}
