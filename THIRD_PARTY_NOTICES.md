# Third-party notices

This integration ports to JavaScript the knowledge of the OpenGarage local
API held by the following project: the `/jc` variables and their meaning
(`door` values including the intermediate states, `vehicle`, `dist`, `rssi`,
`mac`), the `/cc` command built with the device key, and the `result` codes.
No file is copied, and nothing of it is installed at runtime; its notice is
reproduced below as required by its license.

## open-garage (pyOpenGarage)

<https://github.com/Danielhiversen/pyOpenGarage>, version 0.3.1

```
MIT License

Copyright (c) 2019 Daniel Høyer Iversen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## LM1LC3N7/gladys-blebox, gladys-ikea and gladys-mystrom

`src/publisher.js` (from gladys-ikea, through gladys-mystrom and
gladys-blebox) and `src/opengarage/http.js` (adapted from gladys-blebox) come
from integrations of the same author, under the Apache License 2.0 of this
repository.
