import { z, type ZodType } from "zod";
import type { SchemaId } from "./operations.js";

const looseObject = z.record(z.string(), z.unknown());

function envelope(shape: Record<string, ZodType>): ZodType {
  return z.looseObject(shape);
}

const library = envelope({
  id: z.unknown().optional(),
  name: z.unknown().optional(),
  mediaType: z.unknown().optional(),
  folders: z.unknown().optional(),
});

const libraryItem = envelope({
  id: z.unknown().optional(),
  libraryId: z.unknown().optional(),
  mediaType: z.unknown().optional(),
  media: z.unknown().optional(),
});

const user = envelope({
  id: z.unknown().optional(),
  username: z.unknown().optional(),
  type: z.unknown().optional(),
});

const session = envelope({
  id: z.unknown().optional(),
  userId: z.unknown().optional(),
  libraryItemId: z.unknown().optional(),
});

const progress = envelope({
  id: z.unknown().optional(),
  libraryItemId: z.unknown().optional(),
  currentTime: z.unknown().optional(),
  progress: z.unknown().optional(),
  isFinished: z.unknown().optional(),
});

const bookmark = envelope({
  libraryItemId: z.unknown().optional(),
  time: z.unknown().optional(),
  title: z.unknown().optional(),
});

const author = envelope({
  id: z.unknown().optional(),
  name: z.unknown().optional(),
});

const series = envelope({
  id: z.unknown().optional(),
  name: z.unknown().optional(),
});

const collection = envelope({
  id: z.unknown().optional(),
  name: z.unknown().optional(),
  libraryId: z.unknown().optional(),
});

const playlist = envelope({
  id: z.unknown().optional(),
  name: z.unknown().optional(),
  libraryId: z.unknown().optional(),
});

const podcastEpisode = envelope({
  id: z.unknown().optional(),
  title: z.unknown().optional(),
});

const podcastFeed = envelope({
  podcast: z.unknown().optional(),
});

const searchResults = envelope({});
const stats = envelope({});
const settings = envelope({});
const taskList = envelope({ tasks: z.unknown().optional() });
const apiKeyCreated = envelope({
  id: z.unknown().optional(),
  apiKey: z.unknown().optional(),
  name: z.unknown().optional(),
});
const apiKeyList = envelope({ apiKeys: z.unknown().optional() });
const ok = envelope({ ok: z.unknown().optional() });

const SCHEMAS: Record<SchemaId, ZodType> = {
  jsonEnvelope: z.unknown(),
  ok,
  library,
  libraryList: z.union([z.array(looseObject), envelope({ libraries: z.unknown().optional() })]),
  libraryItem,
  libraryItemList: z.union([
    z.array(looseObject),
    envelope({ results: z.unknown().optional(), libraryItems: z.unknown().optional() }),
  ]),
  collection,
  playlist,
  user,
  session,
  sessionList: z.union([z.array(looseObject), envelope({ sessions: z.unknown().optional() })]),
  progress,
  bookmark,
  author,
  series,
  podcastEpisode,
  podcastFeed,
  searchResults,
  stats,
  settings,
  taskList,
  apiKeyCreated,
  apiKeyList,
};

export function schemaFor(id: SchemaId): ZodType {
  return SCHEMAS[id];
}
