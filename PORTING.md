# lucene-ts : portage de Apache Lucene 5.2.1 en TypeScript

Source de référence : `lucene-5.2.1-src.tgz`, extrait dans `../lucene-src/lucene-5.2.1`.
Le portage part du module `core` (~155 000 lignes Java) et avance par couches, de bas en haut :
`util` → `store` → `analysis` → `document` → `index` → `search` (le module `codecs` suit `index`).

## Reprendre le travail (nouvelle session)

1. Les sources Java ne sont **pas** versionnées (83 Mo) : ré-attacher `lucene-5.2.1-src.tgz` et l'extraire dans
   `../lucene-src/` (on doit retrouver `../lucene-src/lucene-5.2.1/core/src/java/…`). `archive.apache.org` est
   bloqué depuis l'environnement cloud.
2. Récupérer le dépôt (`git clone` du remote ou `git clone lucene-ts.bundle lucene-ts`), puis `npm run typecheck && npm test`.
3. Prochaines étapes prévues : `store` (`DataInput`, `DataOutput`, `Directory`…), puis `analysis`.
4. Commiter après chaque classe ou groupe de classes portées et testées ; une couche = plusieurs commits.

## Commandes

```
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx (test/*.test.ts)
tools/golden/generate.sh [chemin/vers/lucene-5.2.1]   # régénère test/golden/util.json, util-refs.json et util-sorters.json (JDK requis)
```

Note : ici `node_modules/@types/node` et `node_modules/tsx` sont des liens vers des installations
globales de la machine (pas d'accès réseau pour `npm install`). Un `npm install` normal les remplace.

## État

| Package Java (`org.apache.lucene.…`) | État |
| --- | --- |
| `util.BitUtil`, `util.MathUtil`, `util.UnicodeUtil`, `util.StringHelper`, `util.BytesRef` | porté, testé contre le Java |
| `util.ArrayUtil`, `util.IntsRef`, `util.LongsRef`, `util.CharsRef`, `util.BytesRefBuilder`, `util.CharsRefBuilder`, `util.IntsRefBuilder`, `StringHelper.intsRefToBytesRef` | porté, testé contre le Java |
| `util.Sorter`, `IntroSorter`, `InPlaceMergeSorter`, `TimSorter`, `ArrayIntroSorter`, `ArrayInPlaceMergeSorter`, `ArrayTimSorter`, `CollectionUtil`, `ArrayUtil.introSort`/`timSort` | porté, testé contre le Java (ordre final **et** nombre exact d'appels `compare`/`swap`/`copy`/`save`/`restore`) |
| `util.RamUsageEstimator` | constantes de taille seulement (`sizeOf` & co à faire) |
| `util.OfflineSorter` | à faire avec `store` (dépend de `Directory`/fichiers) |
| reste de `util` (≈170 fichiers), `store`, `analysis`, `document`, `index`, `search`, `codecs` | à faire |

## Conventions de portage

- Une classe Java = un fichier TS de même nom, mêmes noms de méthodes (la traçabilité avec le Java prime).
  Les classes utilitaires `final` à méthodes statiques deviennent des classes TS à membres `static`.
- Les en-têtes de licence Apache sont conservés.
- `int` → `number` maintenu en 32 bits signés (`| 0`, `Math.imul`) ; `long` → `bigint` maintenu en 64 bits
  signés (`BigInt.asIntN(64, …)`) ; `long[]` → `BigInt64Array` ; `byte[]` → `Uint8Array` (valeurs 0..255,
  non signées) ; `char[]` → `Uint16Array` ; `CharSequence`/`String` → `string` (même unité UTF-16).
  Les helpers `Integer` et `Long` (`src/util/JavaNumbers.ts`) reproduisent `Integer.bitCount`, `Long.ushr`, etc.
- Les surcharges Java deviennent des surcharges TS quand les types se distinguent (`number` / `bigint` /
  `string` / `Uint8Array` / `BytesRef`), sinon des noms distincts (`MathUtil.log` pour `log(long,int)`,
  `MathUtil.logDouble` pour `log(double,double)`).
- Exceptions : `IllegalArgumentException`, `IllegalStateException`, `ArrayIndexOutOfBoundsException`,
  `NumberFormatException`… (`src/errors.ts`).
- `CharSequence` → `type CharSequence = string | CharsRef` (`src/util/CharsRef.ts`), avec `charSequenceLength` /
  `charSequenceCharAt`. Un `char` Java est un code UTF-16 dans un `number` (`char[]` = `Uint16Array`).
- Les surcharges de `grow`/`shrink` d'`ArrayUtil` pour les tableaux typés deviennent une seule méthode générique
  (la taille d'élément vient de `BYTES_PER_ELEMENT`). `boolean[]` et les tableaux de références (`int[][]`,
  `float[][]`) sont des tableaux JS indiscernables à l'exécution : `growBoolean`/`shrinkBoolean`,
  `growRefs`/`shrinkRefs`.
- `java.lang.Character.digit` → `Character.digit` (`src/util/JavaNumbers.ts`), vérifié sur les 65 536 caractères du BMP.
- Divisions entières Java (`currentSize / 2`) → `Math.trunc` ; débordements `int` → `| 0` / `Math.imul`.
- `assert` Java → `lassert(() => cond)` (actif par défaut, `LUCENE_ASSERTIONS=0` pour le désactiver).
- Propriété système `tests.seed` → variable d'environnement `TESTS_SEED`.
- Cycles d'import (`BytesRef` ↔ `UnicodeUtil` ↔ `StringHelper`) : aucune valeur de l'autre module n'est
  utilisée à l'évaluation du module ; les constantes qui en dépendent sont paresseuses (`UnicodeUtil.BIG_TERM`).

## Écarts connus avec le Java

- `CharsRef` n'a pas de méthode `length()` (le champ `length` est gardé : un champ et une méthode ne peuvent pas
  porter le même nom en TypeScript).
- `ArrayUtil.shrink` accepte aussi `Float32Array`/`Float64Array` (Lucene 5.2.1 n'a pas de `shrink(float[])` ni
  `shrink(double[])`) : sur-ensemble inoffensif, non testé contre le Java.
- `RamUsageEstimator` est figé sur une JVM 64 bits avec compressed oops (référence 4 octets, en-tête de tableau
  16 octets). Le Java le mesure sur la JVM courante ; les tests de référence sont donc générés avec
  `-XX:+UseCompressedOops`. Les tailles de croissance d'`ArrayUtil.oversize` en dépendent.
- `BytesRefBuilder.byteAt` renvoie 0..255 (le Java renvoie un `byte` signé).
- Visibilité package : TypeScript n'a pas de visibilité « package », donc les membres package-private de `Sorter`,
  `TimSorter`, `IntroSorter`… (`insertionSort`, `mergeInPlace`, `lower`, `rotate`, `quicksort`…) sont publics et marqués
  `@internal`. Les membres `protected` du Java le restent. `ArrayIntroSorter`, `ArrayInPlaceMergeSorter` et
  `ArrayTimSorter` (package-private en Java) ne sont pas exportés par `src/index.ts`.
- `TimSorter.THRESHOLD` (64) masque `Sorter.THRESHOLD` (20) comme en Java ; les sorters génériques inlinent
  `ArrayUtil.swap` pour éviter un import circulaire.
- `java.util.List` (listes à accès aléatoire seulement, seul cas accepté par `CollectionUtil`) devient un tableau.
- **Assertions et comparaisons** : `TimSorter.mergeLo`/`mergeHi` appellent `compare()` dans un `assert`. Le port évalue
  ses assertions par défaut (`LUCENE_ASSERTIONS=0` les coupe) ; `util-sorters.json` est donc généré avec `java -ea`
  (comme la suite de tests de Lucene) et les tests de comptage d'appels sont ignorés si les assertions sont coupées.
  Vérifié dans les deux sens : golden sans `-ea` = port avec `LUCENE_ASSERTIONS=0`, golden avec `-ea` = port par défaut.

- Une écriture hors limites dans un tableau typé est ignorée silencieusement (Java lève
  `ArrayIndexOutOfBoundsException`). Les lectures tronquées de `UTF8toUTF16` lèvent bien l'exception.
- Les `long` en `bigint` sont nettement plus lents que les `long` Java : à revoir pour les structures chaudes
  (`FixedBitSet`, packed ints, etc.) quand on y arrivera.
- `hashCode()` de `BytesRef` utilise une graine aléatoire par processus, comme en Java (voir `TESTS_SEED`).

## Vérification

- Tests unitaires : `test/util-*.test.ts`.
- Tests différentiels : `test/golden-util*.test.ts` comparent le port à des valeurs produites par les classes
  Java d'origine (`tools/golden/Golden.java`, graine `tests.seed=DEADBEEF`). Pour chaque nouvelle couche
  portée, étendre `Golden.java` plutôt que d'écrire les valeurs attendues à la main.
