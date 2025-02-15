{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, utils, ... }:
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShell = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs_22.pkgs.prettier
            pkgs.nodejs_22
          ];

          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            echo "Bun: $(bun --version) Node: $(node --version | awk '{gsub(/v/, "");}1') Biome: $(biome --version | awk '{print $2}')" \
                  | ${pkgs.cowsay}/bin/cowsay | ${pkgs.lolcat}/bin/lolcat
          '';
        };
      }
    );
}
