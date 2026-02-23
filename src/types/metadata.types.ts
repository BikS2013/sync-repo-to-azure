/**
 * Result of a metadata get/set/update/delete operation.
 */
export interface MetadataResult {
  /** Full blob path within the container */
  path: string;
  /** User-defined metadata key-value pairs */
  metadata: Record<string, string>;
}

/**
 * Result of a tag get/set operation.
 */
export interface TagResult {
  /** Full blob path within the container */
  path: string;
  /** Blob index tags key-value pairs */
  tags: Record<string, string>;
}

/**
 * Result of a tag query operation.
 */
export interface TagQueryResult {
  /** The OData filter expression used */
  filter: string;
  /** Blobs matching the tag filter */
  matches: TagQueryMatch[];
}

/**
 * A single blob matching a tag query.
 */
export interface TagQueryMatch {
  /** Blob name */
  name: string;
  /** Tags on the matching blob */
  tags: Record<string, string>;
}
