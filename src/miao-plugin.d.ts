declare module '*/xopenbot.js' {
  import type { IPlugin } from '@xopenbot/plugin';

  const Plugin: IPlugin;
  export default Plugin;
  export { Plugin as plugin };
}
