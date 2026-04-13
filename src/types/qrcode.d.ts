declare module 'qrcode' {
  type QrColorOptions = {
    dark?: string;
    light?: string;
  };

  type QrOptions = {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    type?: 'svg';
    color?: QrColorOptions;
  };

  const QRCode: {
    toDataURL(text: string, options?: QrOptions): Promise<string>;
    toString(text: string, options?: QrOptions): Promise<string>;
  };

  export default QRCode;
}
