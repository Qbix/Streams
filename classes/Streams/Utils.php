<?php

class Streams_Utils
{
    /**
     * Builds a nested tree of related streams up to a specified depth.
     * Can traverse in either direction (from category to members, or from member to categories).
     *
     * @method buildStreamTree
     * @static
     * @param array $stream Associative array representing a stream row (must include 'publisherId' and 'name')
     * @param array $options Optional config:
     *   - depth {int} Max depth to recurse (default 3)
     *   - isCategory {bool} If true, traverses members of a category via streams_related_to.
     *                       If false, traverses categories of a member via streams_related_from.
     *   - levelSchemas {array} (Optional) An array of options for each depth level.
     *       Each item is a schema with:
     *         - fields {array} Field names to include from streams_stream (default: [])
     *         - attributes {array} Attribute names to include from parsed attributes JSON (default: [])
     *         - rename {array} Map of output field name => stream field name (e.g. ['title' => 'title'])
     * @return array A nested tree representing the stream and its related streams.
     */
    static function buildStreamTree(array $stream, array $options = []) {
        $depth = isset($options['depth']) ? (int)$options['depth'] : 3;
        if ($depth < 1) return [];

        $isCategory = !empty($options['isCategory']);
        $schemas = isset($options['levelSchemas']) ? $options['levelSchemas'] : [];

        $joins = [];
        $selects = [];
        $aliasCounter = 0;

        // Base stream
        $from = "streams_stream AS s0";
        $selects[] = "s0.publisherId AS s0_publisherId";
        $selects[] = "s0.name AS s0_name";
        $selects[] = "s0.attributes AS s0_attributes";

        $schema = isset($schemas[0]) ? $schemas[0] : [];
        $fields = isset($schema['fields']) ? $schema['fields'] : [];
        $rename = isset($schema['rename']) ? $schema['rename'] : [];

        foreach ($fields as $field) {
            $selects[] = "s0.`$field` AS s0_$field";
        }

        // Build joins and selects
        for ($i = 1; $i <= $depth; ++$i) {
            $r = "r$i";
            $s = "s$i";
            $prev = "s" . ($i - 1);
            $relTable = $isCategory ? "streams_related_to" : "streams_related_from";

            if ($isCategory) {
                $joins[] = "LEFT JOIN $relTable AS $r ON $r.toPublisherId = $prev.publisherId AND $r.toStreamName = $prev.name";
                $joins[] = "LEFT JOIN streams_stream AS $s ON $s.publisherId = $r.fromPublisherId AND $s.name = $r.fromStreamName";
            } else {
                $joins[] = "LEFT JOIN $relTable AS $r ON $r.fromPublisherId = $prev.publisherId AND $r.fromStreamName = $prev.name";
                $joins[] = "LEFT JOIN streams_stream AS $s ON $s.publisherId = $r.toPublisherId AND $s.name = $r.toStreamName";
            }

            $selects[] = "$s.publisherId AS {$s}_publisherId";
            $selects[] = "$s.name AS {$s}_name";
            $selects[] = "$s.attributes AS {$s}_attributes";
            $selects[] = "$r.type AS {$r}_type";

            $schema = isset($schemas[$i]) ? $schemas[$i] : [];
            $fields = isset($schema['fields']) ? $schema['fields'] : [];
            foreach ($fields as $field) {
                $selects[] = "$s.`$field` AS {$s}_$field";
            }
        }

        // Final query
        $publisherId = Q::quote($stream['publisherId']);
        $name = Q::quote($stream['name']);

        $sql = "SELECT " . implode(", ", $selects) . " FROM $from " . implode(" ", $joins)
            . " WHERE s0.publisherId = $publisherId AND s0.name = $name";

        $rows = Q::fetchAll($sql);

        // Convert rows to tree
        $root = [];
        foreach ($rows as $row) {
            $pointer = &$root;
            for ($i = 0; $i <= $depth; ++$i) {
                $s = "s$i";
                if (!isset($row["{$s}_publisherId"]) || !isset($row["{$s}_name"])) break;

                $id = "{$row["{$s}_publisherId"]}/{$row["{$s}_name"]}";
                if (!isset($pointer['@seen'])) $pointer['@seen'] = [];
                if (isset($pointer['@seen'][$id])) {
                    $pointer = &$pointer['@seen'][$id];
                    continue;
                }

                $schema = isset($schemas[$i]) ? $schemas[$i] : [];
                $fields = isset($schema['fields']) ? $schema['fields'] : [];
                $attrs = isset($schema['attributes']) ? $schema['attributes'] : [];
                $rename = isset($schema['rename']) ? $schema['rename'] : [];

                $node = [];
                foreach ($fields as $field) {
                    $key = array_search($field, $rename) !== false ? $rename[$field] : $field;
                    $node[$key] = $row["{$s}_$field"];
                }

                // Parse attributes JSON
                $attrJson = $row["{$s}_attributes"];
                if ($attrJson) {
                    $decoded = json_decode($attrJson, true);
                    if (is_array($decoded)) {
                        $node['attributes'] = [];
                        foreach ($attrs as $attr) {
                            if (array_key_exists($attr, $decoded)) {
                                $node['attributes'][$attr] = $decoded[$attr];
                            }
                        }
                    }
                }

                // Move pointer to child container
                if (!isset($pointer['@children'])) $pointer['@children'] = [];

                if ($i > 0) {
                    $r = "r$i";
                    $type = $row["{$r}_type"] ?? '';
                    if (!isset($pointer['@children'][$type])) {
                        $pointer['@children'][$type] = [];
                    }
                    $pointer['@children'][$type][] = &$node;
                } else {
                    $pointer = &$node;
                }

                $pointer['@seen'][$id] = &$node;
                $pointer = &$node;
            }
        }
        unset($pointer); // break reference loop

        if (isset($root['@seen'])) unset($root['@seen']);
        return $root;
    }

}