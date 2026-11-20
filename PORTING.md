# lucene-ts : portage de Apache Lucene 5.2.1 en TypeScript

Source de référence : `lucene-5.2.1-src.tgz`, extrait dans `../lucene-src/lucene-5.2.1`.
Le portage part du module `core` (~155 000 lignes Java) et avance par couches, de bas en haut :
`util` → `store` → `analysis` → `document` → `index` → `search` (le module `codecs` suit `index`).

## Reprendre le travail (nouvelle session)

1. Les sources Java ne sont **pas** versionnées (83 Mo) : ré-attacher `lucene-5.2.1-src.tgz` et l'extraire dans
   `../lucene-src/` (on doit retrouver `../lucene-src/lucene-5.2.1/core/src/java/…`). `archive.apache.org` est
   bloqué depuis l'environnement cloud.
2. Récupérer le dépôt (`git clone` du remote ou `git clone lucene-ts.bundle lucene-ts`), puis `npm run typecheck && npm test`.
3. Prochaines étapes prévues : fin de `store` (il ne reste que `LockStressTest`/`LockVerifyServer`, outils de test à
   sockets, non portés), `util.OfflineSorter`, puis `analysis`.
4. Commiter après chaque classe ou groupe de classes portées et testées ; une couche = plusieurs commits.

## Commandes

```
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx (test/*.test.ts)
tools/golden/generate.sh [chemin/vers/lucene-5.2.1]   # régénère test/golden/*.json : util, util-refs, util-sorters, store-data, store-io, store-dir, store-more, store-fs (JDK requis)
```

Note : ici `node_modules/@types/node` et `node_modules/tsx` sont des liens vers des installations
globales de la machine (pas d'accès réseau pour `npm install`). Un `npm install` normal les remplace.

## État

| Package Java (`org.apache.lucene.…`) | État |
| --- | --- |
| `util.BitUtil`, `util.MathUtil`, `util.UnicodeUtil`, `util.StringHelper`, `util.BytesRef` | porté, testé contre le Java |
| `util.ArrayUtil`, `util.IntsRef`, `util.LongsRef`, `util.CharsRef`, `util.BytesRefBuilder`, `util.CharsRefBuilder`, `util.IntsRefBuilder`, `StringHelper.intsRefToBytesRef` | porté, testé contre le Java |
| `util.Sorter`, `IntroSorter`, `InPlaceMergeSorter`, `TimSorter`, `ArrayIntroSorter`, `ArrayInPlaceMergeSorter`, `ArrayTimSorter`, `CollectionUtil`, `ArrayUtil.introSort`/`timSort` | porté, testé contre le Java (ordre final **et** nombre exact d'appels `compare`/`swap`/`copy`/`save`/`restore`) |
| `store.DataInput`, `DataOutput`, `ByteArrayDataInput`, `ByteArrayDataOutput`, `InputStreamDataInput`, `OutputStreamDataOutput`, `AlreadyClosedException` (+ `io/*`, `util.JavaCollections`, `util.JavaUtf8Decoder`) | porté, testé contre le Java (octets écrits, valeurs relues, entrées tronquées/malformées, ordre d'itération des maps/sets, UTF-8 exhaustif) |
| `store.IndexInput`, `IndexOutput`, `RandomAccessInput`, `IOContext` (+ `FlushInfo`, `MergeInfo`), `BufferedIndexInput`, `ChecksumIndexInput`, `BufferedChecksumIndexInput`, `BufferedChecksum` (+ `zip.CRC32`) | porté, testé contre le Java (résultats **et** suite exacte des appels `readInternal`/`seekInternal`) |
| `store.Directory`, `BaseDirectory`, `FilterDirectory`, `TrackingDirectoryWrapper`, `RAMDirectory`, `RAMFile`, `RAMInputStream`, `RAMOutputStream`, `Lock` (+ `Lock.With`), `LockFactory`, `NoLockFactory`, `SingleInstanceLockFactory`, `LockObtainFailedException`, `LockReleaseFailedException` (+ `util.IOUtils` partiel, `Accountable`, `Accountables`, `AtomicLong`, `ThreadInterruptedException`, `RamUsageEstimator.humanReadableUnits`) | porté, testé contre le Java (scripts aléatoires sur `RAMDirectory`, 64 combinaisons de pannes de `copyFrom` avec exceptions supprimées, verrous, `IOUtils`…) ; tests de mutation : aucun survivant non équivalent |
| `store.OutputStreamIndexOutput`, `RateLimiter` (+ `SimpleRateLimiter`), `RateLimitedIndexOutput`, `FileSwitchDirectory`, `NRTCachingDirectory` (+ `io.BufferedOutputStream`/`FilterOutputStream`, `zip.CheckedOutputStream`, `errors.FileSystemException` & co, `JavaNumbers.doubleToString`) | porté, testé contre le Java (suite exacte des écritures vers le flux sous-jacent, pannes de write/flush/close avec exceptions supprimées imbriquées, décisions de cache NRT, `sync`/`close` transmis aux délégués, `Double.toString` du JDK) ; mutations : aucun survivant non équivalent |
| `store.FSDirectory`, `SimpleFSDirectory`, `NIOFSDirectory`, `MMapDirectory`, `ByteBufferIndexInput`, `FSLockFactory`, `SimpleFSLockFactory`, `NativeFSLockFactory`, `VerifyingLockFactory` (+ `nio/ByteBuffer`, `nio/FileChannel`, `nio/Files`, `util.Constants`, `util.WeakIdentityMap`, `IOUtils.fsync`/`rm`/`deleteFilesIfExist`, `errors.getMessage`) | porté, testé contre le Java (scripts aléatoires dans un répertoire temporaire : création/lecture/renommage/suppression/sync, entrées lues après `close`, répertoires à la place de fichiers, mmap par morceaux de 1 à 2^30 octets, slices et clones, verrous, protocole de `VerifyingLockFactory`, `ByteBuffer` du JDK) ; mutation testing automatique (336 mutants d'opérateurs sur ces fichiers : 297 tués, les ~35 survivants sont équivalents : commentaires, messages AIOOBE du JDK, gardes inatteignables, champs inutilisés) ; `LockStressTest`/`LockVerifyServer` (sockets) non portés |
| `util.RamUsageEstimator` | constantes de taille + `humanReadableUnits` (`sizeOf` & co à faire) |
| `util.OfflineSorter` | à faire (dépend de `Directory`) |
| reste de `util` (≈165 fichiers), `analysis`, `document`, `index`, `search`, `codecs` | à faire |

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

## Conventions propres à `store`

- E/S **synchrones** (comme en Java). `java.io` est réduit à ce que Lucene utilise : `src/io/` (`Closeable`,
  `InputStream`, `OutputStream`, `ByteArrayInputStream`, `ByteArrayOutputStream`) ; `IOException`/`EOFException`
  dans `src/errors.ts`.
- Un `long` qui est une **donnée** (`readLong`, `readVLong`, `readZLong`, `writeLong`…) est un `bigint` ; un `long` qui
  est une **position/longueur/compteur d'octets** (`skipBytes`, `length()`, `getFilePointer()`, `seek()`…) devient un
  `number` (toujours < 2^53).
- `readByte()` renvoie 0..255 ; `writeByte(b)` garde les 8 bits de poids faible (comme le cast `(byte)`).
- `DataInput.readBytes(b, offset, len, useBuffer?)` fusionne les deux surcharges Java ; `DataOutput.writeBytes(b, length)`
  (2 arguments) n'est pas porté : écrire `writeBytes(b, 0, length)`.
- `DataInput.clone()` est une copie superficielle de tous les champs (`Object.clone`).
- `readString` n'utilise **pas** `TextDecoder` : sa gestion des octets UTF-8 invalides diffère du JDK (ED A0 80 → 1 U+FFFD
  en Java, 3 en WHATWG). `decodeUtf8Java` (`src/util/JavaUtf8Decoder.ts`) reprend l'algorithme du JDK 21, vérifié sur
  toutes les séquences de 1 et 2 octets et sur des familles de 3 à 6 octets (empreinte SHA-256 des résultats Java).
- Les `HashMap`/`HashSet` que Java renvoie (`readStringStringMap`, `readStringSet`, `readMapOfStrings`/`readSetOfStrings`
  au-delà de 10 éléments) sont des `Map`/`Set` JS **construits dans l'ordre d'itération de Java**
  (`javaHashOrder`, `src/util/JavaCollections.ts`) ; jusqu'à 10 éléments Java renvoie un `TreeMap`/`TreeSet`
  (tri par code UTF-16, `compareJavaStrings`). Ces résultats ne sont pas modifiables côté Java ; côté TS le type est
  `ReadonlyMap`/`ReadonlySet`.
- `ByteArrayDataInput` « omet tous les contrôles » : lire au-delà du tableau lève `ArrayIndexOutOfBoundsException`
  (et non `EOFException`), la position ayant déjà avancé comme avec `bytes[pos++]`.

- `Directory` : `Collection<String>` → `Iterable<string>` ; les longueurs de fichier sont des `number` ; la
  try-with-resources de `copyFrom` est écrite à la main (ressources fermées en ordre inverse, exceptions de
  `close()` ajoutées en *suppressed* — `addSuppressed`/`getSuppressed` dans `src/errors.ts`).
- `Lock.obtain(long timeout)` s'appelle `Lock.obtainWait(timeout)` (TypeScript ne peut pas surcharger la méthode
  abstraite `obtain()` que les sous-classes implémentent) ; `Lock.With` est aussi exporté sous `LockWith`, `doBody()`
  est générique. `Thread.sleep` bloque le thread (`sleepSync`, `Atomics.wait`).
- `RAMDirectory` : pas de constructeur `RAMDirectory(FSDirectory, IOContext)` (pas encore de `FSDirectory`) ;
  `listAll()` renvoie les noms dans l'ordre d'insertion (le `ConcurrentHashMap` Java n'a pas d'ordre spécifié) ;
  monothread, donc ni `synchronized` ni verrous ; `sizeInBytes` est un `AtomicLong` à valeur `number`.
- Les membres package-private/protected utilisés par les classes sœurs (`RAMFile.length`, `addBuffer`, `getBuffer`…)
  sont publics + `@internal`. `getBuffer` lève `IndexOutOfBoundsException` comme `ArrayList.get`.
- `System.arraycopy` : `arraycopy` (`src/util/JavaObjects.ts`) vérifie les bornes avant de copier et lève
  `ArrayIndexOutOfBoundsException` avec les messages du JDK ; `RAMInputStream.readByte` reproduit aussi l'AIOOBE / NPE
  d'un `seek` négatif hors slice (messages du JDK 21, seule la classe est comparée dans les tests).
- `Object.toString()` / `hashCode()` par défaut → `identityHashCode`/`objectToString` (`JavaObjects.ts`) : nom de classe
  sans paquet + hash d'identité, jamais comparable octet pour octet avec Java.
- `IOUtils` : seules les fonctions `Closeable`/`Directory`/`reThrow*` sont portées (pas de `Path`/`Files`) ; les
  surcharges varargs/`Iterable` sont fusionnées. Toute `Error` autre qu'`IOException` est « non contrôlée »
  (il n'y a pas d'équivalent de `java.lang.Exception`).
- `java.io` : `OutputStream` gagne `flush()` ; `BufferedOutputStream`/`FilterOutputStream`/`CheckedOutputStream` reproduisent la
  sémantique du JDK 21 (écritures directes quand `len >= taille du tampon`, `close()` idempotent qui ferme le flux
  même si `flush()` échoue, message `Range [off, off + len) out of bounds for length n`). `tryWithResource`
  (`JavaObjects.ts`) émule un try-with-resources à une ressource.
- `Double.toString` → `doubleToString` (chiffres les plus courts ; deux chiffres significatifs quand un seul suffit, comme
  le JDK ≥ 19 : `4.9E-324`). `(long) double` → `doubleToLong` (bigint, saturé). `System.nanoTime` : bigint (`RateLimiter`),
  `Thread.sleep` : `sleepSync`. Les `long` d'octets ≥ 2^53 sont approximés (ex. `getMinPauseCheckBytes()` saturé).
- `FileSwitchDirectory`/`NRTCachingDirectory.listAll()` rendent l'ordre d'un `HashSet` Java (`javaHashOrder`) à partir de
  l'ordre d'insertion ; les tests comparent des listes triées car `RAMDirectory.listAll()` n'a pas d'ordre spécifié.
- `BaseDirectory.isOpen` est public (+ `@internal`) car `NRTCachingDirectory` le lit.
- Système de fichiers (`src/nio/`) : un `java.nio.file.Path` est une `string` ; `Files` (sous-ensemble : `createDirectories`,
  `createFile`, `delete`, `deleteIfExists`, `size`, `atomicMove`, `newOutputStream`, `toRealPath`…), `ByteBuffer` (big-endian,
  `position`/`limit`/`slice`/`duplicate`, messages d'exception du JDK 21 : `IndexOutOfBoundsException` **sans message**) et
  `FileChannel` (descripteurs `node:fs` synchrones) émulent le JDK ; les erreurs `errno` sont traduites en
  `NoSuchFileException`, `FileAlreadyExistsException`, `FileSystemException("chemin: Not a directory")`… comme
  `UnixException.translateToIOException`. `getMessage(e)` (`errors.ts`) rend `null` pour une exception sans message
  (Lucene écrit `ioe.getMessage() + ": " + this` → `"null: …"` après un `close()`).
- `assert cond` sans message lève une `AssertionError` **sans message** (comme Java).
- `FSDirectory.listAll(Path)` (statique) s'appelle `FSDirectory.listAllIn` ; `listAll()` renvoie les noms triés
  (Java : ordre de `readdir`, non spécifié ; les tests comparent des listes triées).
- `FSDirectory.open` renvoie un `NIOFSDirectory` (ou `SimpleFSDirectory` sous Windows) : `MMapDirectory.UNMAP_SUPPORTED` est
  `false` (Node ne peut ni mapper ni démapper), donc `setUseUnmap(true)` lève et aucun clone n'est suivi.
  `MMapDirectory` « mappe » des copies en mémoire (instantané du fichier à l'ouverture).
- `NativeFSLockFactory` n'exclut que les instances du **même processus** (`LOCK_HELD` + table de `FileChannel.tryLock`) :
  Node n'a pas de verrou de fichier du système ; un autre processus qui tient le même fichier n'est pas détecté.
- `Accountable.getChildResources()` renvoie un tableau en lecture seule ; `System.lineSeparator()` = `"\n"`.

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
  Java d'origine (`tools/golden/Golden.java`, graine `tests.seed=DEADBEEF` ; `GoldenStore.java` pour `store`). Pour chaque nouvelle couche
  portée, étendre `Golden.java` plutôt que d'écrire les valeurs attendues à la main.
