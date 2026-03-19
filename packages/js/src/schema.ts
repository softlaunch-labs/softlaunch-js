import { i } from "@instantdb/core";

// Minimal schema for SDK $files queries — just enough to get typed `url` field
const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
  },
  links: {},
  rooms: {},
});

type _Schema = typeof _schema;
interface SdkSchema extends _Schema {}
const schema: SdkSchema = _schema;

export default schema;
