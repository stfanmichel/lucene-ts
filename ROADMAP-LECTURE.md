# Feuille de route : lire des index Lucene 4.x / 5.x

Priorité décidée avec l'utilisateur (2026-11-22) : **lire** des index existants créés par Lucene Java 4 ou 5 ; l'écriture
(IndexWriter, merges, codecs en écriture) vient après. Cible : le comportement de Lucene 5.2.1 (core + backward-codecs).

## Matériau de test
- Des index réels de 4.0 à 5.1 sont fournis par l'arbre Java : `backward-codecs/src/test/org/apache/lucene/index/index.*.zip`
  (4.0.0.2, 4.2.0/4.2.1, 4.3.0, 4.9.1, 4.10.0, 5.0.0, 5.1.0, cfs et nocfs, + `moreterms.5.0.0`, `*.undeadnorms.zip`).
- Les index 5.2.1 sont produits par le Java d'origine (harnais `tools/golden`), avec des variantes : cfs/non-cfs, suppressions,
  doc values de chaque type, vecteurs de termes, champs stockés volumineux, plusieurs segments.
- Chaque étape est validée par comparaison avec le lecteur Java d'origine (dump de ce que lit la classe Java, rejoué en TS).

## Taille estimée du chemin de lecture (fermeture des dépendances, hors écriture)
≈ 415 fichiers / 97 000 lignes Java, dont ≈ 30 000 déjà portées (store, util). Reste ≈ 65 000 lignes, contre ≈ 135 000 pour tout
le cœur : lire d'abord économise environ la moitié. `util.packed` (8 700 lignes) est en grande partie du code généré
(BulkOperation*) : à générer par script plutôt qu'à porter à la main.

## Jalons
| # | Jalon | Contenu | Validation |
|---|-------|---------|------------|
| M0 | Prérequis `util` | `Version`, `util.packed` (lecteurs, `BlockPackedReader`, `DirectReader`, BulkOperation générées), `PagedBytes`, `util.fst` (lecture), `util.automaton` (`CompiledAutomaton`, `RunAutomaton`, `ByteRunAutomaton`), `AttributeSource` | goldens Java (comme `util-small`) |
| M1 | Métadonnées d'index | `CodecUtil`, registre des codecs (table statique à la place du SPI), `IndexFileNames`, `SegmentInfos` (segments_N, toutes versions 4.0→5.2), `SegmentInfo`, `SegmentCommitInfo`, `FieldInfo(s)`, `Lucene50` SegmentInfo/FieldInfos/Compound/LiveDocs | dump des segments, champs, fichiers, suppressions = Java, sur tous les zips |
| M2 | Documents stockés | package `document` (Document, Field, FieldType, StoredField, `DocumentStoredFieldVisitor`), `codecs.compressing` (LZ4, DEFLATE via `node:zlib`, `CompressingStoredFieldsReader`), `Lucene50StoredFieldsFormat` | `reader.document(i)` identique pour tous les docs |
| M3 | Termes et postings | `BlockTreeTermsReader` (+FST), `Lucene50PostingsReader` (ForUtil), `PerFieldPostingsFormat`, `IndexReader`/`LeafReader`/`CodecReader`/`SegmentReader`/`DirectoryReader`/`MultiReader`/`MultiFields`/`MultiTermsEnum`, `Terms`, `TermsEnum`, `PostingsEnum` (docs, freqs, positions, offsets, payloads) | énumération complète des termes + postings = Java |
| M4 | DocValues, normes, vecteurs | `Lucene50DocValuesFormat`, normes, `PerFieldDocValuesFormat`, `CompressingTermVectorsReader`, les 5 types de doc values | valeurs doc par doc = Java |
| M5 | Recherche | `IndexSearcher`, `Weight`/`Scorer`/`BulkScorer`, `TermQuery`, `BooleanQuery`, `PhraseQuery`, `MatchAllDocsQuery`, `TermRangeQuery`/`NumericRangeQuery`, `PrefixQuery`/`WildcardQuery`/`RegexpQuery`/`FuzzyQuery`, filtres, `Sort`/`TopDocs`/collecteurs, `DefaultSimilarity`/`BM25Similarity` | TopDocs (doc ids et scores, bit à bit sur les floats) = Java |
| M6 | Index 4.x | codecs `lucene40`, `41`, `42`, `45`, `46`, `49`, `410` (backward-codecs), `SegmentInfos` anciens formats | mêmes dumps que M1–M5 sur les zips 4.x |
| M7 | Texte libre | `analysis` (Analyzer, TokenStream, attributs) pour construire des requêtes à partir de texte ; éventuellement un QueryParser minimal (le vrai est dans un module hors cœur) | à décider |

## Hors périmètre pour l'instant
Écriture d'index (IndexWriter, DocumentsWriter, merges, codecs en écriture), NRT, snapshots, `CheckIndex`, `IndexUpgrader`,
Lucene 3.x (non lisible par 5.2.1), modules (facet, grouping, highlighter, queryparser…).
