# Test fixture — RSA private key header

Category: private_key
Expected: critical

Planted secret (header only, body omitted; detector triggers on header):

```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
-----END RSA PRIVATE KEY-----
```
