declare module "robots-parser" {
  interface RobotsParser {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
  }

  export default function robotsParser(url: string, contents: string): RobotsParser;
}
