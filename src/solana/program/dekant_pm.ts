/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/dekant_pm.json`.
 */
export type DekantPm = {
  "address": "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
  "metadata": {
    "name": "dekantPm",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "DekantPM prediction market protocol"
  },
  "instructions": [
    {
      "name": "addLiquidity",
      "docs": [
        "Deposit proportional liquidity into a market."
      ],
      "discriminator": [
        181,
        157,
        89,
        67,
        143,
        182,
        52,
        72
      ],
      "accounts": [
        {
          "name": "provider",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "lpPosition",
          "docs": [
            "LP position — created on first deposit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "provider"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "providerAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "addLiquidityArgs"
            }
          }
        }
      ]
    },
    {
      "name": "assignRole",
      "docs": [
        "Assign a role (Admin, Oracle, Creator) to a wallet."
      ],
      "discriminator": [
        255,
        174,
        125,
        180,
        203,
        155,
        202,
        131
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The admin or superadmin assigning the role. Must be mut (pays rent)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "docs": [
            "Protocol config — used to check if authority is superadmin."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authorityRole",
          "docs": [
            "The authority's own role PDA (proves they are admin).",
            "Optional: not needed if authority == superadmin.",
            "Validated in handler logic, not in constraints, because it's conditional."
          ],
          "optional": true
        },
        {
          "name": "targetUser",
          "docs": [
            "The wallet receiving the role."
          ]
        },
        {
          "name": "userRole",
          "docs": [
            "UserRole PDA to be created."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "assignRoleArgs"
            }
          }
        }
      ]
    },
    {
      "name": "buy",
      "docs": [
        "Buy outcome tokens for a single discrete outcome."
      ],
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "trader",
          "docs": [
            "The trader placing the buy."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "docs": [
            "Trader's position — created on first trade via init_if_needed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "docs": [
            "Vault authority PDA (signs CPI transfers from vault)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Market's collateral vault."
          ],
          "writable": true
        },
        {
          "name": "traderAta",
          "docs": [
            "Trader's collateral token account (source of payment)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "buyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "buyDistribution",
      "docs": [
        "Buy across bins proportional to a Normal(mu, sigma) distribution."
      ],
      "discriminator": [
        81,
        82,
        164,
        124,
        2,
        240,
        199,
        229
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "buyDistributionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "buyToPrice",
      "docs": [
        "Buy outcome tokens to reach a target probability."
      ],
      "discriminator": [
        35,
        254,
        253,
        143,
        228,
        169,
        99,
        124
      ],
      "accounts": [
        {
          "name": "trader",
          "docs": [
            "The trader placing the buy."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "docs": [
            "Trader's position — created on first trade via init_if_needed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "docs": [
            "Vault authority PDA (signs CPI transfers from vault)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Market's collateral vault."
          ],
          "writable": true
        },
        {
          "name": "traderAta",
          "docs": [
            "Trader's collateral token account (source of payment)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "buyToPriceArgs"
            }
          }
        }
      ]
    },
    {
      "name": "claimPayout",
      "docs": [
        "Claim payout from a resolved market."
      ],
      "discriminator": [
        127,
        240,
        132,
        62,
        227,
        198,
        146,
        133
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userPosition"
          ]
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderAta",
          "docs": [
            "Trader's collateral token account (receives payout)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "collectFees",
      "docs": [
        "Sweep accumulated protocol fees from a market's vault to the treasury."
      ],
      "discriminator": [
        164,
        152,
        207,
        99,
        30,
        186,
        19,
        182
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Anyone can call — pays the transaction fee."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "treasuryAta",
          "docs": [
            "Treasury's collateral token account (receives fees)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "docs": [
        "Create a new prediction market with initial liquidity."
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "Market creator. Pays rent and initial liquidity."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "creatorRole",
          "docs": [
            "Creator's role PDA (Creator, Admin, or Superadmin)."
          ],
          "optional": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "oracleRole",
          "docs": [
            "Oracle's role PDA — verifies the oracle has the Oracle role."
          ]
        },
        {
          "name": "market",
          "docs": [
            "Market account to be created."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "protocol_config.market_count",
                "account": "protocolConfig"
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "docs": [
            "The collateral token mint (e.g. USDC)."
          ]
        },
        {
          "name": "vaultAuthority",
          "docs": [
            "Vault authority PDA — owns the vault token account. Does not hold data."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Vault token account — holds collateral for this market."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "creatorAta",
          "docs": [
            "Creator's associated token account (source of initial liquidity)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "collateralMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creatorLpPosition",
          "docs": [
            "LP position for the creator (receives initial LP shares)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "creator"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createMarketArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "One-time protocol initialization. Sets superadmin, treasury, and default fees."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The deployer who becomes superadmin."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "docs": [
            "Protocol config singleton. Created once."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeArgs"
            }
          }
        }
      ]
    },
    {
      "name": "pauseMarket",
      "docs": [
        "Pause an active market (freezes all trading)."
      ],
      "discriminator": [
        216,
        238,
        4,
        164,
        65,
        11,
        162,
        91
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Admin or superadmin."
          ],
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authorityRole",
          "docs": [
            "Authority's admin role PDA (if not superadmin)."
          ],
          "optional": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "removeLiquidity",
      "docs": [
        "Withdraw proportional liquidity from a market."
      ],
      "discriminator": [
        80,
        85,
        209,
        72,
        24,
        206,
        177,
        108
      ],
      "accounts": [
        {
          "name": "provider",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "lpPosition"
          ]
        },
        {
          "name": "lpPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "provider"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "providerAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "removeLiquidityArgs"
            }
          }
        }
      ]
    },
    {
      "name": "resolveMarket",
      "docs": [
        "Oracle submits the resolved outcome."
      ],
      "discriminator": [
        155,
        23,
        80,
        173,
        46,
        74,
        23,
        239
      ],
      "accounts": [
        {
          "name": "oracle",
          "docs": [
            "The assigned oracle. Must match market.oracle."
          ],
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "resolveMarketArgs"
            }
          }
        }
      ]
    },
    {
      "name": "revokeRole",
      "docs": [
        "Revoke a role from a wallet (closes the UserRole PDA)."
      ],
      "discriminator": [
        179,
        232,
        2,
        180,
        48,
        227,
        82,
        7
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The admin or superadmin revoking the role. Receives reclaimed rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authorityRole",
          "docs": [
            "Authority's own role PDA (if admin, not superadmin)."
          ],
          "optional": true
        },
        {
          "name": "targetUser",
          "docs": [
            "The wallet whose role is being revoked."
          ]
        },
        {
          "name": "userRole",
          "docs": [
            "UserRole PDA to be closed. Rent returned to authority."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "revokeRoleArgs"
            }
          }
        }
      ]
    },
    {
      "name": "sell",
      "docs": [
        "Sell outcome tokens for a single discrete outcome."
      ],
      "discriminator": [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userPosition"
          ]
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderAta",
          "docs": [
            "Trader's collateral token account (receives payment)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "sellArgs"
            }
          }
        }
      ]
    },
    {
      "name": "sellAll",
      "docs": [
        "Sell the trader's entire position in a continuous market.",
        "Reads holdings directly from the position account — no distribution fitting needed."
      ],
      "discriminator": [
        100,
        215,
        153,
        65,
        230,
        47,
        248,
        97
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userPosition"
          ]
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "sellAllArgs"
            }
          }
        }
      ]
    },
    {
      "name": "sellDistribution",
      "docs": [
        "Sell across bins proportional to a Normal(mu, sigma) distribution."
      ],
      "discriminator": [
        232,
        149,
        36,
        68,
        96,
        184,
        140,
        73
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userPosition"
          ]
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderAta",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "sellDistributionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "sellToPrice",
      "docs": [
        "Sell outcome tokens to reach a target probability."
      ],
      "discriminator": [
        69,
        149,
        213,
        52,
        140,
        91,
        216,
        237
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "userPosition"
          ]
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderAta",
          "docs": [
            "Trader's collateral token account (receives payment)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "sellToPriceArgs"
            }
          }
        }
      ]
    },
    {
      "name": "unpauseMarket",
      "docs": [
        "Unpause a paused market. If deadline has passed, transitions to PendingResolution."
      ],
      "discriminator": [
        219,
        203,
        199,
        170,
        212,
        45,
        170,
        80
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Admin or superadmin."
          ],
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authorityRole",
          "docs": [
            "Authority's admin role PDA (if not superadmin)."
          ],
          "optional": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.market_id",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updateFees",
      "docs": [
        "Update protocol fee parameters (superadmin only)."
      ],
      "discriminator": [
        225,
        27,
        13,
        6,
        69,
        84,
        172,
        191
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Must be the superadmin."
          ],
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateFeesArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "lpPosition",
      "discriminator": [
        105,
        241,
        37,
        200,
        224,
        2,
        252,
        90
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "protocolConfig",
      "discriminator": [
        207,
        91,
        250,
        28,
        152,
        179,
        215,
        209
      ]
    },
    {
      "name": "userPosition",
      "discriminator": [
        251,
        248,
        209,
        245,
        83,
        234,
        17,
        27
      ]
    },
    {
      "name": "userRole",
      "discriminator": [
        62,
        252,
        194,
        137,
        183,
        165,
        147,
        28
      ]
    }
  ],
  "events": [
    {
      "name": "feesCollected",
      "discriminator": [
        233,
        23,
        117,
        225,
        107,
        178,
        254,
        8
      ]
    },
    {
      "name": "feesUpdated",
      "discriminator": [
        65,
        34,
        234,
        59,
        248,
        242,
        101,
        118
      ]
    },
    {
      "name": "liquidityChanged",
      "discriminator": [
        132,
        132,
        193,
        214,
        12,
        99,
        40,
        28
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketPaused",
      "discriminator": [
        174,
        108,
        119,
        17,
        118,
        97,
        185,
        4
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "marketUnpaused",
      "discriminator": [
        191,
        149,
        243,
        234,
        175,
        225,
        179,
        126
      ]
    },
    {
      "name": "payoutClaimed",
      "discriminator": [
        200,
        39,
        105,
        112,
        116,
        63,
        58,
        149
      ]
    },
    {
      "name": "roleAssigned",
      "discriminator": [
        15,
        207,
        225,
        171,
        169,
        117,
        98,
        131
      ]
    },
    {
      "name": "roleRevoked",
      "discriminator": [
        167,
        183,
        52,
        229,
        126,
        206,
        62,
        61
      ]
    },
    {
      "name": "tradePlaced",
      "discriminator": [
        86,
        63,
        114,
        34,
        82,
        86,
        59,
        156
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Signer does not have the required role"
    },
    {
      "code": 6001,
      "name": "invalidRole",
      "msg": "Invalid role type"
    },
    {
      "code": 6002,
      "name": "roleAlreadyAssigned",
      "msg": "This role is already assigned to the target wallet"
    },
    {
      "code": 6003,
      "name": "adminCannotAssignAdmin",
      "msg": "Admin cannot assign the Admin role; only superadmin can"
    },
    {
      "code": 6004,
      "name": "marketNotActive",
      "msg": "Market is not in Active state"
    },
    {
      "code": 6005,
      "name": "marketClosed",
      "msg": "Market deadline has passed; no more trading"
    },
    {
      "code": 6006,
      "name": "marketNotPendingResolution",
      "msg": "Market is not in PendingResolution state"
    },
    {
      "code": 6007,
      "name": "marketAlreadyResolved",
      "msg": "Market has already been resolved"
    },
    {
      "code": 6008,
      "name": "marketPaused",
      "msg": "Market is paused"
    },
    {
      "code": 6009,
      "name": "marketNotPaused",
      "msg": "Market is not paused"
    },
    {
      "code": 6010,
      "name": "marketNotResolved",
      "msg": "Market is not in Resolved state"
    },
    {
      "code": 6011,
      "name": "invalidOutcome",
      "msg": "Invalid outcome index"
    },
    {
      "code": 6012,
      "name": "invalidRange",
      "msg": "range_max must be greater than range_min"
    },
    {
      "code": 6013,
      "name": "invalidDeadline",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6014,
      "name": "invalidNumOutcomes",
      "msg": "Number of outcomes is out of allowed bounds"
    },
    {
      "code": 6015,
      "name": "invalidMarketType",
      "msg": "Invalid market type"
    },
    {
      "code": 6016,
      "name": "binCountExceeded",
      "msg": "Bin count exceeds maximum"
    },
    {
      "code": 6017,
      "name": "invalidKernelWidth",
      "msg": "kernel_width must be < num_outcomes for continuous markets, and 0 for binary/multi"
    },
    {
      "code": 6018,
      "name": "insufficientBalance",
      "msg": "Insufficient collateral balance"
    },
    {
      "code": 6019,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity in the AMM"
    },
    {
      "code": 6020,
      "name": "insufficientHoldings",
      "msg": "Insufficient token holdings to sell"
    },
    {
      "code": 6021,
      "name": "tradeTooSmall",
      "msg": "Trade amount is below the minimum"
    },
    {
      "code": 6022,
      "name": "invalidSigma",
      "msg": "Sigma must be greater than zero"
    },
    {
      "code": 6023,
      "name": "wrongMarketType",
      "msg": "This instruction is not valid for this market type"
    },
    {
      "code": 6024,
      "name": "invalidProbability",
      "msg": "Target probability out of valid range"
    },
    {
      "code": 6025,
      "name": "targetAlreadyMet",
      "msg": "Target probability is already met or on the wrong side of current price"
    },
    {
      "code": 6026,
      "name": "maxCollateralExceeded",
      "msg": "Required collateral exceeds max_collateral"
    },
    {
      "code": 6027,
      "name": "minCollateralNotMet",
      "msg": "Returned collateral is below min_collateral_out"
    },
    {
      "code": 6028,
      "name": "alreadyClaimed",
      "msg": "Payout has already been claimed"
    },
    {
      "code": 6029,
      "name": "nothingToClaim",
      "msg": "No winning tokens held; nothing to claim"
    },
    {
      "code": 6030,
      "name": "invariantViolation",
      "msg": "L2-norm invariant violated after operation"
    },
    {
      "code": 6031,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6032,
      "name": "divisionByZero",
      "msg": "Division by zero"
    },
    {
      "code": 6033,
      "name": "sqrtFailed",
      "msg": "Square root computation failed"
    },
    {
      "code": 6034,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the maximum allowed basis points"
    },
    {
      "code": 6035,
      "name": "noFeesToCollect",
      "msg": "No protocol fees to collect"
    },
    {
      "code": 6036,
      "name": "insufficientShares",
      "msg": "Cannot remove more LP shares than held"
    },
    {
      "code": 6037,
      "name": "liquidityTooSmall",
      "msg": "Liquidity amount is below the minimum"
    },
    {
      "code": 6038,
      "name": "resolvedValueOutOfRange",
      "msg": "Resolved value is outside the market range"
    },
    {
      "code": 6039,
      "name": "wrongOracle",
      "msg": "Signer is not the assigned oracle for this market"
    }
  ],
  "types": [
    {
      "name": "addLiquidityArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "docs": [
              "Amount of collateral to deposit as liquidity (token-native units)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "assignRoleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "role",
            "docs": [
              "Role to assign (1=Admin, 2=Oracle, 3=Creator)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "buyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "outcome",
            "docs": [
              "Which outcome to buy (0..num_outcomes-1)."
            ],
            "type": "u16"
          },
          {
            "name": "collateralAmount",
            "docs": [
              "Amount of collateral to spend (token-native units, e.g. USDC micro-units)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "buyDistributionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mu",
            "docs": [
              "Center of the Normal distribution (same scale as market.range_min/max)."
            ],
            "type": "i64"
          },
          {
            "name": "sigma",
            "docs": [
              "Standard deviation of the Normal distribution (same scale, must be > 0)."
            ],
            "type": "u64"
          },
          {
            "name": "collateralAmount",
            "docs": [
              "Amount of collateral to spend (token-native units)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "buyToPriceArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "outcome",
            "docs": [
              "Which outcome to buy (0..num_outcomes-1)."
            ],
            "type": "u16"
          },
          {
            "name": "targetProbability",
            "docs": [
              "Target probability for this outcome, scaled to SCALE (e.g. 700_000_000 = 70%)."
            ],
            "type": "u64"
          },
          {
            "name": "maxCollateral",
            "docs": [
              "Maximum gross collateral the trader is willing to pay (slippage protection)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "createMarketArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketType",
            "docs": [
              "0 = Binary, 1 = Multi, 2 = Continuous."
            ],
            "type": "u8"
          },
          {
            "name": "numOutcomes",
            "docs": [
              "Number of outcomes (binary=2, multi=3..32) or bins (continuous=2..256)."
            ],
            "type": "u16"
          },
          {
            "name": "deadline",
            "docs": [
              "Unix timestamp deadline."
            ],
            "type": "i64"
          },
          {
            "name": "oracle",
            "docs": [
              "Oracle wallet authorized to resolve."
            ],
            "type": "pubkey"
          },
          {
            "name": "initialLiquidity",
            "docs": [
              "Collateral to deposit as initial liquidity (token-native units)."
            ],
            "type": "u64"
          },
          {
            "name": "rangeMin",
            "docs": [
              "Lower bound of continuous range (scaled 10^9). 0 for discrete."
            ],
            "type": "i64"
          },
          {
            "name": "rangeMax",
            "docs": [
              "Upper bound of continuous range (scaled 10^9). 0 for discrete."
            ],
            "type": "i64"
          },
          {
            "name": "kernelWidth",
            "docs": [
              "Smooth settlement kernel width for continuous markets — number of bins",
              "on each side of the winning bin that receive partial payouts.",
              "0 = winner-take-all (default). Ignored (forced to 0) for binary/multi.",
              "Must be < num_outcomes for continuous markets."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "feesCollected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "collector",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "feesUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "creationFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "redemptionFeeBps",
            "type": "u16"
          },
          {
            "name": "lpFeeShareBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "initializeArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "docs": [
              "Wallet that receives protocol fees."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "liquidityChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "provider",
            "type": "pubkey"
          },
          {
            "name": "isAdd",
            "type": "bool"
          },
          {
            "name": "collateralAmount",
            "type": "u64"
          },
          {
            "name": "sharesChanged",
            "type": "u128"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "lpPosition",
      "docs": [
        "An LP's share in a specific market's liquidity pool.",
        "Seeds: [\"lp_position\", market_pubkey, user_pubkey]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "docs": [
              "Schema version."
            ],
            "type": "u8"
          },
          {
            "name": "market",
            "docs": [
              "The market this LP position belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "user",
            "docs": [
              "The LP's wallet."
            ],
            "type": "pubkey"
          },
          {
            "name": "shares",
            "docs": [
              "Number of LP shares held. Proportional to the LP's fraction of the pool."
            ],
            "type": "u128"
          },
          {
            "name": "depositedCollateral",
            "docs": [
              "Cumulative collateral deposited as liquidity."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "padding",
            "docs": [
              "Reserved for future fields."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "A prediction market with its AMM state.",
        "Unified struct for binary, multi-outcome, and continuous (binned) markets.",
        "Seeds: [\"market\", market_id.to_le_bytes()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "docs": [
              "Schema version for upgrade-safe deserialization."
            ],
            "type": "u8"
          },
          {
            "name": "marketId",
            "docs": [
              "Unique, auto-incremented market identifier."
            ],
            "type": "u64"
          },
          {
            "name": "marketType",
            "docs": [
              "0 = Binary, 1 = Multi-outcome, 2 = Continuous. See MarketType."
            ],
            "type": "u8"
          },
          {
            "name": "state",
            "docs": [
              "Current lifecycle state. See MarketState."
            ],
            "type": "u8"
          },
          {
            "name": "creator",
            "docs": [
              "Wallet that created this market."
            ],
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "docs": [
              "Oracle wallet authorized to resolve this market."
            ],
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "docs": [
              "SPL token mint used as collateral (e.g. USDC)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Address of the SPL token vault holding collateral."
            ],
            "type": "pubkey"
          },
          {
            "name": "deadline",
            "docs": [
              "Unix timestamp after which trading stops and resolution can begin."
            ],
            "type": "i64"
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix timestamp of market creation."
            ],
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "docs": [
              "Unix timestamp of resolution (0 until resolved)."
            ],
            "type": "i64"
          },
          {
            "name": "numOutcomes",
            "docs": [
              "Number of outcomes (binary = 2, multi ≤ 32) or bins (continuous ≤ 256).",
              "Determines the length of the `reserves` vector."
            ],
            "type": "u16"
          },
          {
            "name": "kSquared",
            "docs": [
              "Squared L2-norm invariant: Σ reserves[i]² = k_squared.",
              "Stored as u128 to avoid overflow on sums of u64 squares."
            ],
            "type": "u128"
          },
          {
            "name": "totalMinted",
            "docs": [
              "Total collateral deposited as complete sets (token-native units).",
              "At any time: ∀ i, total_minted = reserves[i] + Σ_users(holdings[i])."
            ],
            "type": "u128"
          },
          {
            "name": "lpSharesTotal",
            "docs": [
              "Total outstanding LP shares across all providers."
            ],
            "type": "u128"
          },
          {
            "name": "lpFeeAccumulated",
            "docs": [
              "Accumulated LP fee portion (collateral-native units).",
              "Paid out proportionally when LPs remove liquidity."
            ],
            "type": "u128"
          },
          {
            "name": "protocolFeeAccumulated",
            "docs": [
              "Accumulated protocol fee (collateral-native units).",
              "Swept to treasury via `collect_fees` instruction."
            ],
            "type": "u64"
          },
          {
            "name": "rangeMin",
            "docs": [
              "Lower bound of the continuous outcome range (scaled by 10^9).",
              "0 for discrete markets."
            ],
            "type": "i64"
          },
          {
            "name": "rangeMax",
            "docs": [
              "Upper bound of the continuous outcome range (scaled by 10^9).",
              "0 for discrete markets."
            ],
            "type": "i64"
          },
          {
            "name": "resolvedOutcome",
            "docs": [
              "Index of the winning outcome (binary/multi) or winning bin (continuous).",
              "Only meaningful when state == Resolved."
            ],
            "type": "u16"
          },
          {
            "name": "resolvedValue",
            "docs": [
              "Exact resolved value for continuous markets (same scale as range_min/max).",
              "0 for discrete markets."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "Market PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "vaultAuthorityBump",
            "docs": [
              "Vault authority PDA bump seed (for CPI signing)."
            ],
            "type": "u8"
          },
          {
            "name": "kernelWidth",
            "docs": [
              "Smooth settlement kernel width (bins on each side of winner).",
              "0 = winner-take-all (default, backward-compatible — matches existing",
              "markets whose padding deserializes as zero). Only meaningful for",
              "continuous markets; binary/multi force this to 0 at initialization."
            ],
            "type": "u16"
          },
          {
            "name": "scalingFactor",
            "docs": [
              "Solvency scaling factor for kernel resolution (SCALE-denominated).",
              "0 until the market is resolved; SCALE (10^9) once resolved when no",
              "dilution is needed; < SCALE when raw kernel claims would exceed",
              "`total_minted` (proportionally dilutes each claimant). Only meaningful",
              "for continuous markets with `kernel_width > 0`."
            ],
            "type": "u64"
          },
          {
            "name": "padding",
            "docs": [
              "Reserved for future schema versions. Consumed from the front",
              "when new fields are added; total byte offset of `reserves` stays",
              "constant for a given padding size."
            ],
            "type": {
              "array": [
                "u8",
                20
              ]
            }
          },
          {
            "name": "reserves",
            "docs": [
              "AMM reserves per outcome/bin.",
              "Length = num_outcomes. Serialized as Borsh Vec (4-byte length prefix + data)."
            ],
            "type": {
              "vec": "u64"
            }
          },
          {
            "name": "traderTokenTotals",
            "docs": [
              "Total trader-held tokens per outcome/bin (sum of all UserPosition holdings).",
              "Maintained by buy/sell instructions. Used at resolution to compute the",
              "true LP residual: `total_minted - trader_token_totals[win]`.",
              "Without this, `reserves[win]` diverges from the LP residual after LP",
              "operations scale positions without changing trader holdings."
            ],
            "type": {
              "vec": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "marketType",
            "type": "u8"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "numOutcomes",
            "type": "u16"
          },
          {
            "name": "initialLiquidity",
            "type": "u64"
          },
          {
            "name": "rangeMin",
            "type": "i64"
          },
          {
            "name": "rangeMax",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketPaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "resolvedOutcome",
            "type": "u16"
          },
          {
            "name": "resolvedValue",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketUnpaused",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "payoutClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "grossAmount",
            "type": "u64"
          },
          {
            "name": "feePaid",
            "type": "u64"
          },
          {
            "name": "netAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "protocolConfig",
      "docs": [
        "Singleton global configuration for the DekantPM protocol.",
        "Seeds: [\"protocol_config\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "docs": [
              "Schema version for future migrations."
            ],
            "type": "u8"
          },
          {
            "name": "superadmin",
            "docs": [
              "Wallet with full administrative authority (role assignment, fee updates)."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Destination wallet for collected protocol fees."
            ],
            "type": "pubkey"
          },
          {
            "name": "marketCount",
            "docs": [
              "Auto-incrementing counter; next market gets this ID, then it increments."
            ],
            "type": "u64"
          },
          {
            "name": "creationFeeBps",
            "docs": [
              "Fee charged when a new market is created (basis points of initial liquidity)."
            ],
            "type": "u16"
          },
          {
            "name": "tradeFeeBps",
            "docs": [
              "Fee charged on every buy/sell trade (basis points of collateral amount)."
            ],
            "type": "u16"
          },
          {
            "name": "redemptionFeeBps",
            "docs": [
              "Fee charged when a trader redeems a winning payout (basis points of gross payout)."
            ],
            "type": "u16"
          },
          {
            "name": "lpFeeShareBps",
            "docs": [
              "Fraction of the trade fee directed to LPs (basis points of the trade fee itself).",
              "Remainder goes to protocol_fee_accumulated."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "padding",
            "docs": [
              "Reserved for future fields."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "removeLiquidityArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sharesToBurn",
            "docs": [
              "Number of LP shares to burn."
            ],
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "resolveMarketArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "outcome",
            "docs": [
              "Winning outcome index (binary: 0 or 1, multi: 0..N-1).",
              "For continuous markets, this is ignored (computed from `value`)."
            ],
            "type": "u16"
          },
          {
            "name": "value",
            "docs": [
              "Exact resolved value for continuous markets (scaled same as range_min/max).",
              "Set to 0 for binary/multi markets."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "revokeRoleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "role",
            "docs": [
              "Role to revoke (1=Admin, 2=Oracle, 3=Creator)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "roleAssigned",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "role",
            "type": "u8"
          },
          {
            "name": "assignedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "roleRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "role",
            "type": "u8"
          },
          {
            "name": "revokedBy",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "sellAllArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minCollateralOut",
            "docs": [
              "Minimum collateral the trader expects to receive (slippage protection).",
              "Set to 0 to accept any amount."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sellArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "outcome",
            "docs": [
              "Which outcome to sell (0..num_outcomes-1)."
            ],
            "type": "u16"
          },
          {
            "name": "tokenAmount",
            "docs": [
              "Number of outcome tokens to sell back to the AMM."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sellDistributionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mu",
            "docs": [
              "Center of the Normal distribution describing which bins to sell from."
            ],
            "type": "i64"
          },
          {
            "name": "sigma",
            "docs": [
              "Standard deviation."
            ],
            "type": "u64"
          },
          {
            "name": "tokenAmount",
            "docs": [
              "Total tokens to sell (distributed proportionally across bins)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sellToPriceArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "outcome",
            "docs": [
              "Which outcome to sell (0..num_outcomes-1)."
            ],
            "type": "u16"
          },
          {
            "name": "targetProbability",
            "docs": [
              "Target probability for this outcome, scaled to SCALE (e.g. 300_000_000 = 30%).",
              "Use 0 to sell the entire position."
            ],
            "type": "u64"
          },
          {
            "name": "minCollateralOut",
            "docs": [
              "Minimum net collateral the trader is willing to receive (slippage protection)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tradePlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "isBuy",
            "type": "bool"
          },
          {
            "name": "collateralAmount",
            "docs": [
              "Collateral paid (buy) or received (sell), before/after fees."
            ],
            "type": "u64"
          },
          {
            "name": "outcomeIndex",
            "docs": [
              "Outcome index for discrete trades; 0 for distribution trades."
            ],
            "type": "u16"
          },
          {
            "name": "mu",
            "docs": [
              "Distribution center (continuous only; 0 for discrete)."
            ],
            "type": "i64"
          },
          {
            "name": "sigma",
            "docs": [
              "Distribution width (continuous only; 0 for discrete)."
            ],
            "type": "u64"
          },
          {
            "name": "tokensTransacted",
            "docs": [
              "Total outcome tokens transacted across all bins/outcomes."
            ],
            "type": "u64"
          },
          {
            "name": "feePaid",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "updateFeesArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creationFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "redemptionFeeBps",
            "type": "u16"
          },
          {
            "name": "lpFeeShareBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "userPosition",
      "docs": [
        "A trader's token holdings in a specific market.",
        "Seeds: [\"user_position\", market_pubkey, user_pubkey]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "docs": [
              "Schema version."
            ],
            "type": "u8"
          },
          {
            "name": "market",
            "docs": [
              "The market this position belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "user",
            "docs": [
              "The trader's wallet."
            ],
            "type": "pubkey"
          },
          {
            "name": "totalDeposited",
            "docs": [
              "Cumulative collateral deposited into this market by this trader."
            ],
            "type": "u64"
          },
          {
            "name": "totalWithdrawn",
            "docs": [
              "Cumulative collateral withdrawn from this market by this trader."
            ],
            "type": "u64"
          },
          {
            "name": "claimed",
            "docs": [
              "Whether the post-resolution payout has been claimed."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "padding",
            "docs": [
              "Reserved for future fields."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "holdings",
            "docs": [
              "Token holdings per outcome/bin.",
              "Length = market.num_outcomes.",
              "holdings[i] = number of outcome-i tokens this trader owns."
            ],
            "type": {
              "vec": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "userRole",
      "docs": [
        "A role assignment for a single (user, role) pair.",
        "Existence of this PDA means the role is active; closing it revokes the role.",
        "Seeds: [\"user_role\", user_pubkey, role_type_u8]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "docs": [
              "Schema version."
            ],
            "type": "u8"
          },
          {
            "name": "user",
            "docs": [
              "The wallet this role is assigned to."
            ],
            "type": "pubkey"
          },
          {
            "name": "role",
            "docs": [
              "Role type (see Role enum below)."
            ],
            "type": "u8"
          },
          {
            "name": "assignedBy",
            "docs": [
              "Wallet that granted this role."
            ],
            "type": "pubkey"
          },
          {
            "name": "assignedAt",
            "docs": [
              "Unix timestamp of assignment."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
